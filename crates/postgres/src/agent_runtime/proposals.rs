use crate::{Postgres, agents, error::Error, events};
use kivo_agent_runtime::{Command, Proposal, Proposals, ReviewDecision, Status};
use kivo_tenancy::{AgentCapability, AgentMode, Principal};
use sqlx::{Postgres as Pg, Transaction};
use uuid::Uuid;
#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    org_id: Uuid,
    agent_id: Option<Uuid>,
    agent_name: Option<String>,
    principal_id: Uuid,
    request: serde_json::Value,
    preview: serde_json::Value,
    content_hash: String,
    status: String,
    version: i32,
    review_note: String,
}
impl Row {
    fn proposal(self) -> Result<Proposal, Error> {
        let status = match self.status.as_str() {
            "pending" => Status::Pending,
            "reviewed" => Status::Reviewed,
            "rejected" => Status::Rejected,
            "cancelled" => Status::Cancelled,
            _ => return Err(Error::Invalid("Invalid stored proposal state")),
        };
        Ok(Proposal {
            id: self.id,
            org_id: self.org_id,
            agent_id: self.agent_id,
            agent_name: self.agent_name,
            principal_id: self.principal_id,
            status,
            version: self.version,
            content_hash: self.content_hash,
            request: serde_json::from_value(self.request)
                .map_err(|_| Error::Invalid("Invalid stored move"))?,
            preview: serde_json::from_value(self.preview)
                .map_err(|_| Error::Invalid("Invalid stored preview"))?,
            review_note: self.review_note,
        })
    }
}
async fn read(
    tx: &mut Transaction<'_, Pg>,
    caller: Principal,
    org: Uuid,
    id: Uuid,
) -> Result<Proposal, Error> {
    agents::authorize(tx, caller, org, AgentCapability::ReadProposal).await?;
    let principal = if matches!(caller, Principal::Agent { .. }) {
        Some(caller.id())
    } else {
        None
    };
    let row: Row = sqlx::query_as(
        "SELECT p.*,a.name AS agent_name FROM agent_proposals p
         LEFT JOIN agents a ON a.org_id=p.org_id AND a.id=p.agent_id
         WHERE p.org_id=$1 AND p.id=$2 AND ($3::uuid IS NULL OR p.principal_id=$3)",
    )
    .bind(org)
    .bind(id)
    .bind(principal)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(Error::Forbidden)?;
    row.proposal()
}
pub(super) async fn get(
    db: &Postgres,
    caller: Principal,
    org: Uuid,
    id: Uuid,
) -> Result<Proposal, Error> {
    let mut tx = db.pool.begin().await?;
    let result = read(&mut tx, caller, org, id).await?;
    tx.commit().await?;
    Ok(result)
}
pub(super) async fn list(
    db: &Postgres,
    caller: Principal,
    org: Uuid,
    cursor: Option<Uuid>,
) -> Result<Proposals, Error> {
    let mut tx = db.pool.begin().await?;
    agents::authorize(&mut tx, caller, org, AgentCapability::ReadProposal).await?;
    let principal = if matches!(caller, Principal::Agent { .. }) {
        Some(caller.id())
    } else {
        None
    };
    let mut rows: Vec<Row> = sqlx::query_as(
        "SELECT p.*,a.name AS agent_name FROM agent_proposals p
         LEFT JOIN agents a ON a.org_id=p.org_id AND a.id=p.agent_id
         WHERE p.org_id=$1 AND ($2::uuid IS NULL OR p.principal_id=$2)
         AND ($3::uuid IS NULL OR p.id>$3) ORDER BY p.id LIMIT 21",
    )
    .bind(org)
    .bind(principal)
    .bind(cursor)
    .fetch_all(&mut *tx)
    .await?;
    let more = rows.len() > 20;
    rows.truncate(20);
    let next_cursor = if more {
        rows.last().map(|p| p.id)
    } else {
        None
    };
    let proposals = rows
        .into_iter()
        .map(Row::proposal)
        .collect::<Result<_, _>>()?;
    tx.commit().await?;
    Ok(Proposals {
        proposals,
        next_cursor,
    })
}
pub(super) async fn mutate(
    db: &Postgres,
    caller: Principal,
    org: Uuid,
    command: Command,
    key: Uuid,
) -> Result<Proposal, Error> {
    let mut tx = db.pool.begin().await?;
    events::lock(&mut tx, org).await?;
    let capability = match command {
        Command::Propose { .. } | Command::Cancel { .. } => AgentCapability::ProposeMove,
        Command::Review { .. } => AgentCapability::ReadProposal,
    };
    let auth = agents::authorize(&mut tx, caller, org, capability).await?;
    if matches!(command, Command::Review { .. }) && !matches!(caller, Principal::Human(_)) {
        return Err(Error::Forbidden);
    }
    let request = serde_json::json!({"capability":"agentProposals","command":command});
    if let Some(value) = events::replay(&mut tx, org, caller.id(), key, &request).await? {
        return serde_json::from_value(value).map_err(|_| Error::Invalid("Invalid receipt"));
    }
    let id = match command {
        Command::Propose { id, request } => {
            let revision: i64 =
                sqlx::query_scalar("SELECT revision FROM organizations WHERE id=$1")
                    .bind(org)
                    .fetch_one(&mut *tx)
                    .await?;
            if revision != request.source_revision {
                return Err(Error::Conflict);
            }
            let preview = super::preview::calculate(&mut tx, org, &request, &auth).await?;
            let content_hash =
                events::hash(&serde_json::json!({"request":request,"preview":preview}).to_string());
            sqlx::query("INSERT INTO agent_proposals(id,org_id,principal_id,agent_id,request,preview,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7)")
                .bind(id).bind(org).bind(caller.id()).bind(auth.agent_id).bind(serde_json::to_value(request).map_err(|_|Error::Invalid("Invalid move"))?)
                .bind(serde_json::to_value(preview).map_err(|_|Error::Invalid("Invalid preview"))?).bind(content_hash).execute(&mut *tx).await?;
            id
        }
        Command::Review {
            id,
            version,
            content_hash,
            decision,
            note,
        } => {
            if note.chars().count() > 1000 || version < 1 || content_hash.len() != 64 {
                return Err(Error::Invalid(
                    "Use a current proposal hash/version and a note of up to 1000 characters",
                ));
            }
            let proposal = read(&mut tx, caller, org, id).await?;
            if proposal.version != version
                || proposal.content_hash != content_hash
                || proposal.status != Status::Pending
            {
                return Err(Error::Conflict);
            }
            let status = match decision {
                ReviewDecision::MarkReviewed => {
                    if let Some(agent) = proposal.agent_id {
                        let chain =
                            agents::chain(&mut tx, org, agent)
                                .await
                                .map_err(|e| match e {
                                    Error::Unauthorized => Error::Conflict,
                                    other => other,
                                })?;
                        if chain.iter().any(|a| {
                            a.scope.mode != AgentMode::Propose
                                || !a.scope.capabilities.contains(&AgentCapability::ProposeMove)
                                || !a
                                    .scope
                                    .project_ids
                                    .contains(&proposal.preview.original.project_id)
                        }) {
                            return Err(Error::Conflict);
                        }
                    }
                    let current =
                        super::preview::calculate(&mut tx, org, &proposal.request, &auth).await?;
                    if current.source_fingerprint != proposal.preview.source_fingerprint {
                        return Err(Error::Conflict);
                    }
                    "reviewed"
                }
                ReviewDecision::Reject => {
                    if note.trim().is_empty() {
                        return Err(Error::Invalid("Explain why this proposal is rejected"));
                    }
                    "rejected"
                }
            };
            sqlx::query("UPDATE agent_proposals SET status=$1,version=version+1,reviewed_by=$2,review_note=$3,reviewed_at=now() WHERE org_id=$4 AND id=$5")
                .bind(status).bind(caller.id()).bind(note.trim()).bind(org).bind(id).execute(&mut *tx).await?;
            id
        }
        Command::Cancel { id, version } => {
            let proposal = read(&mut tx, caller, org, id).await?;
            if proposal.version != version || proposal.status != Status::Pending {
                return Err(Error::Conflict);
            }
            sqlx::query("UPDATE agent_proposals SET status='cancelled',version=version+1 WHERE org_id=$1 AND id=$2").bind(org).bind(id).execute(&mut *tx).await?;
            id
        }
    };
    let result = read(&mut tx, caller, org, id).await?;
    events::record(&mut tx, org, caller.id(), id, "agent.proposal").await?;
    events::receipt(
        &mut tx,
        org,
        caller.id(),
        key,
        &request,
        &serde_json::to_value(&result).map_err(|_| Error::Invalid("Invalid proposal"))?,
    )
    .await?;
    tx.commit().await?;
    Ok(result)
}
