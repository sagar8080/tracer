use crate::{error::Error, events, jobs, planning, rows::*, tenancy};
use kivo_integrations::*;
use kivo_jobs::{Kind, Lease};
use kivo_planning::{Command, WorkingCalendar, Workspace};
use kivo_tenancy::{Actor, Permission};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;
type Tx<'a> = Transaction<'a, Postgres>;
async fn load(tx: &mut Tx<'_>, org: Uuid, id: Uuid) -> Result<Import, Error> {
    let data: Value = sqlx::query_scalar(
        "SELECT data FROM workbook_imports WHERE org_id=$1 AND id=$2 FOR UPDATE",
    )
    .bind(org)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(Error::NotFound)?;
    serde_json::from_value(data).map_err(|_| Error::Invalid("Stored import could not be decoded"))
}
async fn store(tx: &mut Tx<'_>, org: Uuid, import: &Import) -> Result<(), Error> {
    let data =
        serde_json::to_value(import).map_err(|_| Error::Invalid("Import could not be encoded"))?;
    sqlx::query("UPDATE workbook_imports SET version=$3,status=$4,data=$5,updated_at=now() WHERE org_id=$1 AND id=$2").bind(org).bind(import.id).bind(import.version).bind(&import.status).bind(data).execute(&mut **tx).await?;
    Ok(())
}
async fn replay(
    tx: &mut Tx<'_>,
    org: Uuid,
    actor: Actor,
    key: Uuid,
    input: &Value,
) -> Result<Option<Import>, Error> {
    events::replay(tx, org, actor.user_id, key, input)
        .await?
        .map(|v| serde_json::from_value(v).map_err(|_| Error::Conflict))
        .transpose()
}
async fn finish(
    tx: &mut Tx<'_>,
    org: Uuid,
    actor: Actor,
    key: Uuid,
    input: &Value,
    import: &Import,
    action: &str,
) -> Result<(), Error> {
    store(tx, org, import).await?;
    events::record(tx, org, actor.user_id, import.id, action).await?;
    events::receipt(
        tx,
        org,
        actor.user_id,
        key,
        input,
        &serde_json::to_value(import).map_err(|_| Error::Conflict)?,
    )
    .await?;
    Ok(())
}
async fn current(tx: &mut Tx<'_>, org: Uuid, actor: Actor) -> Result<(), Error> {
    events::lock(tx, org).await?;
    tenancy::require(tx, actor, org, Permission::Plan).await
}
async fn check_work(tx: &mut Tx<'_>, lease: &Lease) -> Result<Import, Error> {
    current(
        tx,
        lease.org_id,
        Actor {
            user_id: lease.actor_id,
        },
    )
    .await?;
    let import = load(tx, lease.org_id, lease.entity_id).await?;
    jobs::fence(tx, lease).await?;
    if (lease.kind == Kind::WorkbookParse && import.status != "queued")
        || (lease.kind == Kind::WorkbookExport && import.status != "published")
    {
        return Err(Error::Conflict);
    }
    Ok(import)
}
pub(super) async fn failed(tx: &mut Tx<'_>, lease: &Lease, code: &str) -> Result<(), Error> {
    let mut import = load(tx, lease.org_id, lease.entity_id).await?;
    if import.status == "queued" {
        import.status = "failed".into();
    }
    if lease.kind == Kind::WorkbookExport {
        import.export_status = Some("failed".into());
    }
    import.error_code = Some(code.into());
    import.version += 1;
    store(tx, lease.org_id, &import).await
}
async fn workspace(tx: &mut Tx<'_>, org: Uuid) -> Result<Workspace, Error> {
    let people = sqlx::query_as::<_, PersonRow>("SELECT * FROM people WHERE org_id=$1")
        .bind(org)
        .fetch_all(&mut **tx)
        .await?;
    let projects = sqlx::query_as::<_, ProjectRow>("SELECT * FROM projects WHERE org_id=$1")
        .bind(org)
        .fetch_all(&mut **tx)
        .await?;
    let assignments =
        sqlx::query_as::<_, AssignmentRow>("SELECT * FROM assignments WHERE org_id=$1")
            .bind(org)
            .fetch_all(&mut **tx)
            .await?;
    let calendars =
        sqlx::query_as::<_, WorkingCalendarRow>("SELECT * FROM working_calendars WHERE org_id=$1")
            .bind(org)
            .fetch_all(&mut **tx)
            .await?;
    let absences = sqlx::query_as::<_, AbsenceRow>("SELECT * FROM absences WHERE org_id=$1")
        .bind(org)
        .fetch_all(&mut **tx)
        .await?;
    Ok(Workspace {
        people: people.into_iter().map(Into::into).collect(),
        projects: projects.into_iter().map(Into::into).collect(),
        assignments: assignments.into_iter().map(Into::into).collect(),
        calendars: calendars.into_iter().map(Into::into).collect(),
        absences: absences.into_iter().map(Into::into).collect(),
        ..Default::default()
    })
}
impl Repository for crate::Postgres {
    async fn read(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
    ) -> Result<Import, kivo_integrations::Error> {
        async {
            let mut tx = self.pool.begin().await?;
            current(&mut tx, org, actor).await?;
            let mut import = load(&mut tx, org, id).await?;
            let dead: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM durable_jobs WHERE entity_id=$1 AND status='dead')",
            )
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
            if dead {
                import.error_code = Some("processing_failed".into());
                if import.status == "queued" {
                    import.status = "failed".into();
                }
                if import.export_status.as_deref() == Some("queued") {
                    import.export_status = Some("failed".into());
                }
            }
            tx.commit().await?;
            Ok::<_, Error>(import)
        }
        .await
        .map_err(Into::into)
    }

    async fn list(&self, actor: Actor, org: Uuid) -> Result<Vec<Import>, kivo_integrations::Error> {
        async {
            let mut tx=self.pool.begin().await?; tenancy::require(&mut tx,actor,org,Permission::Plan).await?;
            // Results are bounded; no workbook/source data is visible to member/viewer roles.
            let rows:Vec<Value>=sqlx::query_scalar("SELECT data || jsonb_build_object('workbook',NULL,'preview',NULL,'review',NULL) FROM workbook_imports WHERE org_id=$1 ORDER BY created_at DESC,id LIMIT 30").bind(org).fetch_all(&mut *tx).await?;
            tx.commit().await?;
            rows.into_iter().map(|v| { let mut import:Import=serde_json::from_value(v).map_err(|_|Error::Conflict)?;
                import.workbook=None; import.review=None; import.preview=None; Ok(import)
            }).collect::<Result<_,Error>>()
        }.await.map_err(Into::into)
    }
    async fn start(
        &self,
        actor: Actor,
        org: Uuid,
        input: Start,
        key: Uuid,
    ) -> Result<Import, kivo_integrations::Error> {
        input.validate()?;
        async {
            let mut tx=self.pool.begin().await?; current(&mut tx,org,actor).await?;
            let request=json!({"action":"import.start","input":input});
            if let Some(old)=replay(&mut tx,org,actor,key,&request).await? { return Ok(old); }
            let file:Option<(String,String,String)>=sqlx::query_as("SELECT filename,content_type,status FROM files WHERE org_id=$1 AND id=$2 FOR SHARE").bind(org).bind(input.file_id).fetch_optional(&mut *tx).await?;
            let Some((filename,content_type,status))=file else { return Err(Error::NotFound); };
            if status!="ready" || !(filename.to_ascii_lowercase().ends_with(".csv") && matches!(content_type.as_str(),"text/csv"|"application/octet-stream") || filename.to_ascii_lowercase().ends_with(".xlsx") && matches!(content_type.as_str(),"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"|"application/octet-stream")) { return Err(Error::Invalid("Complete a supported CSV or XLSX upload first")); }
            let pending:i64=sqlx::query_scalar("SELECT count(*) FROM workbook_imports WHERE org_id=$1 AND status IN ('queued','review')").bind(org).fetch_one(&mut *tx).await?;
            if pending>=10 { return Err(Error::Invalid("Resolve or cancel pending imports before starting another")); }
            let source_id=input.source_id.unwrap_or_else(Uuid::new_v4);
            let (source_version,previous)=if input.source_id.is_some() {
                sqlx::query_as::<_,(i32,Option<Uuid>)>("SELECT version,published_import_id FROM import_sources WHERE org_id=$1 AND id=$2 FOR UPDATE").bind(org).bind(source_id).fetch_optional(&mut *tx).await?.ok_or(Error::NotFound)?
            } else {
                sqlx::query("INSERT INTO import_sources(id,org_id) VALUES($1,$2)").bind(source_id).bind(org).execute(&mut *tx).await?; (0,None)
            };
            let review=if let Some(id)=previous { load(&mut tx,org,id).await?.review } else {None};
            let import=Import{id:Uuid::new_v4(),source_id,file_id:input.file_id,filename,version:1,source_version,status:"queued".into(),provider:input.provider,workbook:None,review,preview:None,export_file_id:None,export_status:None,published_revision:None,error_code:None};
            sqlx::query("INSERT INTO workbook_imports(id,org_id,source_id,file_id,created_by,status,version,data) VALUES($1,$2,$3,$4,$5,'queued',1,$6)").bind(import.id).bind(org).bind(source_id).bind(input.file_id).bind(actor.user_id).bind(serde_json::to_value(&import).map_err(|_|Error::Conflict)?).execute(&mut *tx).await?;
            jobs::enqueue(&mut tx,org,actor.user_id,import.id,Kind::WorkbookParse).await?;
            finish(&mut tx,org,actor,key,&request,&import,"import.start").await?; tx.commit().await?; Ok::<_,Error>(import)
        }.await.map_err(Into::into)
    }
    async fn review(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        input: Review,
        key: Uuid,
    ) -> Result<Import, kivo_integrations::Error> {
        input.validate()?;
        async {
            let mut tx=self.pool.begin().await?; current(&mut tx,org,actor).await?;
            let request=json!({"action":"import.review","id":id,"input":input});
            if let Some(old)=replay(&mut tx,org,actor,key,&request).await? { return Ok(old); }
            let mut import=load(&mut tx,org,id).await?;
            if import.status!="review" || import.version!=input.version { return Err(Error::Conflict); }
            let (version,previous):(i32,Option<Uuid>)=sqlx::query_as("SELECT version,published_import_id FROM import_sources WHERE org_id=$1 AND id=$2 FOR UPDATE").bind(org).bind(import.source_id).fetch_one(&mut *tx).await?;
            import.source_version=version;
            let prior=if let Some(id)=previous { load(&mut tx,org,id).await?.preview.map(|p|p.links).unwrap_or_default() } else {vec![]};
            let revision:i64=sqlx::query_scalar("SELECT revision FROM organizations WHERE id=$1").bind(org).fetch_one(&mut *tx).await?;
            let role=tenancy::role(&mut tx,actor,org).await?.ok_or(Error::Forbidden)?;
            let workspace=workspace(&mut tx,org).await?;
            let book=import.workbook.as_ref().ok_or(Error::Conflict)?;
            import.preview=Some(evaluate(ReconcileContext{org_id:org,org_revision:revision+1,source_version:version,role},&workspace,book,&input,&prior));
            import.review=Some(input); import.version+=1;
            finish(&mut tx,org,actor,key,&request,&import,"import.review").await?; tx.commit().await?; Ok::<_,Error>(import)
        }.await.map_err(Into::into)
    }
    async fn publish(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        version: i32,
        key: Uuid,
    ) -> Result<Import, kivo_integrations::Error> {
        async {
            let mut tx=self.pool.begin().await?; current(&mut tx,org,actor).await?;
            let request=json!({"action":"import.publish","id":id,"version":version});
            if let Some(old)=replay(&mut tx,org,actor,key,&request).await? { return Ok(old); }
            let mut import=load(&mut tx,org,id).await?;
            if import.status!="review" || import.version!=version { return Err(Error::Conflict); }
            let p=import.preview.as_ref().ok_or(Error::Invalid("Review the mapping and reconciliation first"))?;
            if !p.can_publish() { return Err(Error::Invalid("Resolve blocking findings before publishing")); }
            let revision:i64=sqlx::query_scalar("SELECT revision FROM organizations WHERE id=$1").bind(org).fetch_one(&mut *tx).await?;
            let source:i32=sqlx::query_scalar("SELECT version FROM import_sources WHERE org_id=$1 AND id=$2 FOR UPDATE").bind(org).bind(import.source_id).fetch_one(&mut *tx).await?;
            if revision!=p.org_revision || source!=p.source_version { return Err(Error::Conflict); }
            if !p.people.is_empty() { tenancy::require(&mut tx,actor,org,Permission::Administer).await?; }
            let mut commands=Vec::new();
            for new in &p.people { commands.push(Command::Person(new.person.clone())); commands.push(Command::Calendar(WorkingCalendar{id:Uuid::new_v4(),org_id:org,person_id:new.person.id,effective_from:new.effective_from,weekly_minutes:new.weekly_minutes.clone(),version:1})); }
            commands.extend(p.projects.iter().cloned().map(Command::Project));
            commands.extend(p.additions.iter().chain(&p.updates).cloned().map(Command::Assignment));
            commands.extend(p.removals.iter().map(|a|Command::DeleteAssignment{id:a.id,org_id:org,version:a.version}));
            for command in &commands { command.validate().map_err(Error::Invalid)?; planning::persist(&mut tx,command).await?; events::record(&mut tx,org,actor.user_id,command.entity_id(),command.action()).await?; }
            if let Some(review)=&mut import.review {
                for binding in &mut review.people { if binding.id.is_none() { binding.id=p.people.iter().find(|n|n.person.name==binding.label).map(|n|n.person.id); } }
                for binding in &mut review.projects { if binding.id.is_none() { binding.id=p.projects.iter().find(|n|n.name==binding.label).map(|n|n.id); } }
            }
            import.status="published".into(); import.version+=1; import.source_version=source+1; import.published_revision=Some(revision+commands.len() as i64+1);
            sqlx::query("UPDATE import_sources SET version=version+1,published_import_id=$3 WHERE org_id=$1 AND id=$2").bind(org).bind(import.source_id).bind(id).execute(&mut *tx).await?;
            finish(&mut tx,org,actor,key,&request,&import,"import.publish").await?; tx.commit().await?; Ok::<_,Error>(import)
        }.await.map_err(Into::into)
    }
    async fn cancel(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        version: i32,
        key: Uuid,
    ) -> Result<Import, kivo_integrations::Error> {
        async {
            let mut tx=self.pool.begin().await?; current(&mut tx,org,actor).await?;
            let request=json!({"action":"import.cancel","id":id,"version":version});
            if let Some(old)=replay(&mut tx,org,actor,key,&request).await? { return Ok(old); }
            let mut import=load(&mut tx,org,id).await?;
            if import.version!=version || !matches!(import.status.as_str(),"queued"|"review"|"failed") { return Err(Error::Conflict); }
            import.status="cancelled".into(); import.version+=1;
            sqlx::query("UPDATE durable_jobs SET status='cancelled',fence=fence+1,lease_until=NULL WHERE entity_id=$1 AND org_id=$2 AND status IN ('queued','running','dead')").bind(id).bind(org).execute(&mut *tx).await?;
            finish(&mut tx,org,actor,key,&request,&import,"import.cancel").await?; tx.commit().await?; Ok::<_,Error>(import)
        }.await.map_err(Into::into)
    }
    async fn export(
        &self,
        actor: Actor,
        org: Uuid,
        id: Uuid,
        version: i32,
        key: Uuid,
    ) -> Result<Import, kivo_integrations::Error> {
        async {
            let mut tx=self.pool.begin().await?; current(&mut tx,org,actor).await?;
            let request=json!({"action":"import.export","id":id,"version":version});
            if let Some(old)=replay(&mut tx,org,actor,key,&request).await? { return Ok(old); }
            let mut import=load(&mut tx,org,id).await?;
            if import.version!=version || import.status!="published" { return Err(Error::Conflict); }
            jobs::enqueue(&mut tx,org,actor.user_id,id,Kind::WorkbookExport).await?;
            sqlx::query("UPDATE durable_jobs SET status='queued',attempts=0,fence=fence+1,available_at=now(),error_code=NULL WHERE org_id=$1 AND entity_id=$2 AND kind='workbookExport' AND status='dead'").bind(org).bind(id).execute(&mut *tx).await?;
            import.export_status=Some(if import.export_file_id.is_some() { "ready" } else { "queued" }.into()); import.error_code=None;
            import.version+=1;
            finish(&mut tx,org,actor,key,&request,&import,"import.export").await?; tx.commit().await?; Ok::<_,Error>(import)
        }.await.map_err(Into::into)
    }
    async fn work(&self, lease: &Lease) -> Result<Work, kivo_integrations::Error> {
        async {
            let mut tx=self.pool.begin().await?; let import=check_work(&mut tx,lease).await?;
            let row=sqlx::query_as::<_,(Uuid,Uuid,String,String,i64,String,String,String)>("SELECT id,org_id,filename,content_type,size_bytes,status,bucket,object_key FROM files WHERE org_id=$1 AND id=$2 AND status='ready'").bind(lease.org_id).bind(import.file_id).fetch_optional(&mut *tx).await?.ok_or(Error::NotFound)?;
            tx.commit().await?;
            Ok::<_,Error>(Work{import,file:kivo_files::File{id:row.0,org_id:row.1,filename:row.2,content_type:row.3,size_bytes:row.4,status:row.5,bucket:row.6,object_key:row.7}})
        }.await.map_err(Into::into)
    }
    async fn parsed(
        &self,
        lease: &Lease,
        workbook: Workbook,
    ) -> Result<(), kivo_integrations::Error> {
        async {
            let mut tx = self.pool.begin().await?;
            let mut import = check_work(&mut tx, lease).await?;
            import.workbook = Some(workbook);
            import.status = "review".into();
            import.version += 1;
            store(&mut tx, lease.org_id, &import).await?;
            jobs::done(&mut tx, lease).await?;
            events::record(
                &mut tx,
                lease.org_id,
                lease.actor_id,
                import.id,
                "import.parsed",
            )
            .await?;
            tx.commit().await?;
            Ok::<_, Error>(())
        }
        .await
        .map_err(Into::into)
    }
    async fn exported(
        &self,
        lease: &Lease,
        file: &kivo_files::File,
    ) -> Result<(), kivo_integrations::Error> {
        async {
            let mut tx=self.pool.begin().await?; let mut import=check_work(&mut tx,lease).await?;
            if file.org_id!=lease.org_id || file.id!=lease.id { return Err(Error::Conflict); }
            sqlx::query("INSERT INTO files(id,org_id,created_by,filename,content_type,size_bytes,bucket,object_key,status,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ready',now()) ON CONFLICT DO NOTHING").bind(file.id).bind(file.org_id).bind(lease.actor_id).bind(&file.filename).bind(&file.content_type).bind(file.size_bytes).bind(&file.bucket).bind(&file.object_key).execute(&mut *tx).await?;
            import.export_file_id=Some(file.id); import.export_status=Some("ready".into()); import.version+=1;
            store(&mut tx,lease.org_id,&import).await?; jobs::done(&mut tx,lease).await?;
            events::record(&mut tx,lease.org_id,lease.actor_id,import.id,"import.exported").await?; tx.commit().await?; Ok::<_,Error>(())
        }.await.map_err(Into::into)
    }
}
