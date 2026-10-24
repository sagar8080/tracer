use crate::*;
use kivo_planning::{
    Assignment, Person, Project, WorkingCalendar, Workspace, available_minutes_on, base_minutes_on,
};
use kivo_tenancy::Role;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;
pub struct ReconcileContext {
    pub org_id: Uuid,
    pub org_revision: i64,
    pub source_version: i32,
    pub role: Role,
}
pub fn evaluate(
    context: ReconcileContext,
    workspace: &Workspace,
    book: &Workbook,
    review: &Review,
    previous: &[Link],
) -> Preview {
    let ReconcileContext {
        org_id: org,
        org_revision: revision,
        source_version,
        role,
    } = context;
    let (rows, mut findings) = normalize(book, &review.mapping);
    let mut preview = Preview {
        capacity: vec![],
        org_revision: revision,
        source_version,
        people: vec![],
        projects: vec![],
        additions: vec![],
        updates: vec![],
        removals: vec![],
        links: vec![],
        findings: vec![],
        total_minutes: 0,
    };
    let mut people: BTreeMap<String, Person> = BTreeMap::new();
    let mut projects: BTreeMap<String, Project> = BTreeMap::new();
    let mut calendars = workspace.calendars.clone();
    let labels: BTreeSet<_> = rows.iter().map(|r| r.person.clone()).collect();
    let project_labels: BTreeSet<_> = rows.iter().map(|r| r.project.clone()).collect();
    if review.people.iter().any(|p| !labels.contains(&p.label))
        || review
            .projects
            .iter()
            .any(|p| !project_labels.contains(&p.label))
    {
        findings.push(Finding::block(
            "mappingIdentities",
            "Identity mappings must correspond to names in the selected source rows",
            None,
        ));
    }

    if review.people.len() > MAX_ROWS || review.projects.len() > MAX_ROWS {
        findings.push(Finding::block(
            "bindings",
            "Too many identity mappings",
            None,
        ));
    }
    for label in labels {
        let bindings: Vec<_> = review.people.iter().filter(|p| p.label == label).collect();
        if bindings.len() != 1 {
            findings.push(Finding::block("person", "Resolve each person once", None));
            continue;
        }
        let binding = bindings[0];
        let person = if let Some(id) = binding.id {
            workspace
                .people
                .iter()
                .find(|p| p.org_id == org && p.id == id)
                .cloned()
        } else {
            if !role.permits(kivo_tenancy::Permission::Administer) {
                findings.push(Finding::block(
                    "personPermission",
                    "Only an administrator can create scheduled people",
                    None,
                ));
                continue;
            }
            let Some(weekly) = &binding.weekly_minutes else {
                findings.push(Finding::block(
                    "calendar",
                    "Specify working hours for every new person",
                    None,
                ));
                continue;
            };
            if weekly.len() != 7
                || weekly.iter().any(|n| *n < 0 || *n > 1440 || *n % 15 != 0)
                || weekly.iter().all(|n| *n == 0)
            {
                findings.push(Finding::block(
                    "calendar",
                    "Provide seven daily working-minute values in quarter-hour increments",
                    None,
                ));
                continue;
            }
            let first = rows
                .iter()
                .filter(|r| r.person == label)
                .map(|r| r.start)
                .min();
            let Some(first) = first else {
                continue;
            };
            let person = Person {
                id: Uuid::new_v4(),
                org_id: org,
                name: label.clone(),
                role: "Team member".into(),
                team: "Imported".into(),
                daily_minutes: *weekly.iter().max().unwrap_or(&480),
                cost_rate: None,
                color: "sage".into(),
                version: 1,
            };
            if kivo_planning::Command::Person(person.clone())
                .validate()
                .is_err()
            {
                findings.push(Finding::block(
                    "calendar",
                    "A new person's baseline must include at least one hour",
                    None,
                ));
                continue;
            }
            calendars.push(WorkingCalendar {
                id: Uuid::new_v4(),
                org_id: org,
                person_id: person.id,
                effective_from: first,
                weekly_minutes: weekly.clone(),
                version: 1,
            });
            preview.people.push(NewPerson {
                person: person.clone(),
                weekly_minutes: weekly.clone(),
                effective_from: first,
            });
            Some(person)
        };
        if let Some(person) = person {
            people.insert(label, person);
        } else {
            findings.push(Finding::block(
                "person",
                "A selected person is unavailable in this workspace",
                None,
            ));
        }
    }
    for label in rows
        .iter()
        .map(|r| r.project.clone())
        .collect::<BTreeSet<_>>()
    {
        let bindings: Vec<_> = review
            .projects
            .iter()
            .filter(|p| p.label == label)
            .collect();
        if bindings.len() != 1 {
            findings.push(Finding::block("project", "Resolve each project once", None));
            continue;
        }
        let project = if let Some(id) = bindings[0].id {
            workspace
                .projects
                .iter()
                .find(|p| p.id == id && p.org_id == org && p.status != "complete")
                .cloned()
        } else {
            let p = Project {
                id: Uuid::new_v4(),
                org_id: org,
                name: label.clone(),
                client: "Imported".into(),
                color: "lilac".into(),
                budget_minutes: 60,
                bill_rate: None,
                status: "confirmed".into(),
                version: 1,
            };
            preview.projects.push(p.clone());
            Some(p)
        };
        if let Some(p) = project {
            projects.insert(label, p);
        } else {
            findings.push(Finding::block(
                "project",
                "Choose an active project in this workspace",
                None,
            ));
        }
    }
    for row in rows {
        let (Some(person), Some(project)) = (people.get(&row.person), projects.get(&row.project))
        else {
            continue;
        };
        if !review.mapping.accept_calendar_defaults
            && !calendars.iter().any(|c| {
                c.person_id == person.id && c.org_id == org && c.effective_from <= row.start
            })
        {
            findings.push(Finding::block("baselineCalendar","Acknowledge the displayed Monday–Friday baseline or configure this person's calendar",row.cells.first().cloned()));
        }
        let days: Vec<_> = row
            .start
            .iter_days()
            .take(367)
            .take_while(|d| *d <= row.end)
            .filter(|d| base_minutes_on(person, *d, &calendars) > 0)
            .collect();
        if days.is_empty() || (row.total && row.minutes % (15 * days.len() as i32) != 0) {
            findings.push(Finding::block("distribution","Total hours must distribute exactly into quarter-hour allocations across working days",row.cells.last().cloned()));
            continue;
        }
        let daily = if row.total {
            row.minutes / days.len() as i32
        } else {
            row.minutes
        };
        if !(15..=1440).contains(&daily) {
            findings.push(Finding::block(
                "dailyEffort",
                "Daily effort must be between 15 minutes and 24 hours",
                row.cells.last().cloned(),
            ));
            continue;
        }
        let old = previous.iter().find(|v| v.key == row.key);
        let assignment = Assignment {
            id: old.map(|l| l.assignment.id).unwrap_or_else(Uuid::new_v4),
            org_id: org,
            person_id: person.id,
            project_id: project.id,
            title: project.name.clone(),
            start: row.start,
            end: row.end,
            daily_minutes: daily,
            status: "confirmed".into(),
            version: old.map(|l| l.assignment.version + 1).unwrap_or(1),
        };
        if let Some(old) = old {
            let current = workspace
                .assignments
                .iter()
                .find(|a| a.id == old.assignment.id && a.org_id == org);
            if current.is_none_or(|a| a.version != old.assignment.version) {
                findings.push(Finding::block("humanEdit","This imported allocation was edited or removed in Kivo. Preserve it or reconcile it manually before refreshing",row.cells.first().cloned()));
                continue;
            }
            if same_assignment(&assignment, &old.assignment) {
                let mut unchanged = assignment.clone();
                unchanged.version = old.assignment.version;
                preview.links.push(Link {
                    person_name: person.name.clone(),
                    project_name: project.name.clone(),
                    key: row.key,
                    assignment: unchanged,
                    cells: row.cells,
                });
                preview.total_minutes += daily as i64 * days.len() as i64;
                continue;
            }
            preview.updates.push(assignment.clone());
        } else {
            preview.additions.push(assignment.clone());
        }
        preview.total_minutes += daily as i64 * days.len() as i64;
        preview.links.push(Link {
            person_name: person.name.clone(),
            project_name: project.name.clone(),
            key: row.key,
            assignment,
            cells: row.cells,
        });
    }
    for old in previous {
        if !preview.links.iter().any(|l| l.key == old.key) {
            if workspace.assignments.iter().any(|a| {
                a.org_id == org && a.id == old.assignment.id && a.version == old.assignment.version
            }) {
                preview.removals.push(old.assignment.clone());
            } else {
                findings.push(Finding::block(
                    "humanEdit",
                    "A removed source row has a newer Kivo edit. It will not be deleted by refresh",
                    old.cells.first().cloned(),
                ));
            }
        }
    }
    let replaced: BTreeSet<_> = previous.iter().map(|l| l.assignment.id).collect();
    let plan: Vec<_> = workspace
        .assignments
        .iter()
        .filter(|a| a.org_id == org && !replaced.contains(&a.id))
        .chain(preview.links.iter().map(|l| &l.assignment))
        .collect();
    let mut overloaded = 0;
    let mut seen_people = BTreeSet::new();
    for person in people.values() {
        if !seen_people.insert(person.id) {
            continue;
        }
        let dates: BTreeSet<_> = preview
            .links
            .iter()
            .filter(|l| l.assignment.person_id == person.id)
            .flat_map(|l| {
                l.assignment
                    .start
                    .iter_days()
                    .take(367)
                    .take_while(|d| *d <= l.assignment.end)
            })
            .collect();
        for date in dates {
            if base_minutes_on(person, date, &calendars) == 0 {
                continue;
            }
            let scheduled: i32 = plan
                .iter()
                .filter(|a| a.person_id == person.id && a.start <= date && a.end >= date)
                .map(|a| a.daily_minutes)
                .sum();
            if scheduled > available_minutes_on(person, date, &calendars, &workspace.absences) {
                overloaded += 1;
                if preview.capacity.len() < 100 {
                    preview.capacity.push(CapacityImpact {
                        person_id: person.id,
                        name: person.name.clone(),
                        date,
                        available_minutes: available_minutes_on(
                            person,
                            date,
                            &calendars,
                            &workspace.absences,
                        ),
                        planned_minutes: scheduled,
                        calendar_effective_from: calendars
                            .iter()
                            .filter(|c| {
                                c.person_id == person.id
                                    && c.org_id == org
                                    && c.effective_from <= date
                            })
                            .map(|c| c.effective_from)
                            .max(),
                        absence_ids: workspace
                            .absences
                            .iter()
                            .filter(|a| {
                                a.org_id == org
                                    && (a.person_id == Some(person.id) || a.category == "holiday")
                                    && a.start <= date
                                    && a.end >= date
                            })
                            .map(|a| a.id)
                            .collect(),
                    });
                }
            }
        }
    }
    if overloaded > 0 {
        findings.push(Finding::warning("overload",&format!("{overloaded} person-days exceed available capacity, including time off. Effort is preserved; adjust the plan after publishing.")));
    }
    // New project budgets begin at reconciled planned effort, never an invented cap.
    for project in &mut preview.projects {
        let minutes: i64 = preview
            .links
            .iter()
            .filter(|l| l.assignment.project_id == project.id)
            .map(|l| {
                let a = &l.assignment;
                let days = people
                    .values()
                    .find(|p| p.id == a.person_id)
                    .map(|p| {
                        a.start
                            .iter_days()
                            .take(367)
                            .take_while(|d| *d <= a.end)
                            .filter(|d| base_minutes_on(p, *d, &calendars) > 0)
                            .count()
                    })
                    .unwrap_or(0);
                a.daily_minutes as i64 * days as i64
            })
            .sum();
        if minutes > 100_000_000 {
            findings.push(Finding::block(
                "projectBudget",
                "Imported project effort exceeds the supported budget range; split this source",
                None,
            ));
        }
        if minutes < 60 {
            findings.push(Finding::warning("minimumBudget","A new project has less than one planned hour; its initial budget uses Kivo's one-hour minimum."));
        }
        project.budget_minutes = minutes.clamp(60, 100_000_000) as i32;
    }
    preview.findings = findings;
    preview
}
fn same_assignment(a: &Assignment, b: &Assignment) -> bool {
    a.person_id == b.person_id
        && a.project_id == b.project_id
        && a.title == b.title
        && a.start == b.start
        && a.end == b.end
        && a.daily_minutes == b.daily_minutes
        && a.status == b.status
}

#[cfg(test)]
mod evaluation_tests {
    use super::*;

    fn fixture(hours: &str) -> (Uuid, Workbook, Review, Workspace) {
        let org = Uuid::new_v4();
        let values = ["Ada", "Launch", "2026-10-12", "2026-10-16", hours];
        let cells = |values: &[&str], r: usize| {
            values
                .iter()
                .enumerate()
                .map(|(c, v)| Cell {
                    reference: format!("Plan!{c}:{r}"),
                    value: (*v).into(),
                    formula: false,
                })
                .collect()
        };
        let book = Workbook {
            sheets: vec![Sheet {
                merged: false,
                name: "Plan".into(),
                headers: cells(&["Person", "Project", "Start", "End", "Hours"], 1),
                rows: vec![cells(&values, 2)],
            }],
            findings: vec![],
            suggestion: None,
            suggestion_provider: Provider::Manual,
            fingerprint: "fixture".into(),
        };
        let review = Review {
            version: 2,
            mapping: Mapping {
                columns: MappingHint {
                    sheet: 0,
                    layout: Layout::Tabular,
                    person: 0,
                    project: 1,
                    start: Some(2),
                    end: Some(3),
                    effort: Some(4),
                    row_key: None,
                    weeks: vec![],
                    unit: Unit::TotalHours,
                    date_order: DateOrder::Iso,
                },
                accept_calendar_defaults: true,
                accept_cached_formulas: false,
            },
            people: vec![PersonBinding {
                label: "Ada".into(),
                id: None,
                weekly_minutes: Some(vec![480, 480, 480, 480, 480, 0, 0]),
            }],
            projects: vec![ProjectBinding {
                label: "Launch".into(),
                id: None,
            }],
        };
        (org, book, review, Workspace::default())
    }
    #[test]
    fn total_hours_must_reconcile_and_calendars_and_roles_are_explicit() {
        let (org, b, mut r, w) = fixture("20");
        let p = evaluate(
            ReconcileContext {
                org_id: org,
                org_revision: 10,
                source_version: 0,
                role: Role::Owner,
            },
            &w,
            &b,
            &r,
            &[],
        );
        assert!(p.can_publish());
        assert_eq!(p.additions[0].daily_minutes, 240);
        assert_eq!(p.total_minutes, 1200);
        assert!(
            !evaluate(
                ReconcileContext {
                    org_id: org,
                    org_revision: 10,
                    source_version: 0,
                    role: Role::Planner
                },
                &w,
                &b,
                &r,
                &[]
            )
            .can_publish()
        );
        r.people[0].weekly_minutes = None;
        assert!(
            !evaluate(
                ReconcileContext {
                    org_id: org,
                    org_revision: 10,
                    source_version: 0,
                    role: Role::Owner
                },
                &w,
                &b,
                &r,
                &[]
            )
            .can_publish()
        );
        let (org, b, r, w) = fixture("1");
        assert!(
            !evaluate(
                ReconcileContext {
                    org_id: org,
                    org_revision: 0,
                    source_version: 0,
                    role: Role::Owner
                },
                &w,
                &b,
                &r,
                &[]
            )
            .can_publish()
        );
    }
    #[test]
    fn new_human_edits_and_ambiguous_keys_block_refresh() {
        let (org, b, mut r, mut w) = fixture("20");
        let p = evaluate(
            ReconcileContext {
                org_id: org,
                org_revision: 0,
                source_version: 0,
                role: Role::Owner,
            },
            &w,
            &b,
            &r,
            &[],
        );
        w.people = vec![p.people[0].person.clone()];
        w.projects = p.projects.clone();
        w.assignments = p.additions.clone();
        w.assignments[0].version += 1;
        r.people[0].id = Some(w.people[0].id);
        r.projects[0].id = Some(w.projects[0].id);
        let next = evaluate(
            ReconcileContext {
                org_id: org,
                org_revision: 2,
                source_version: 1,
                role: Role::Owner,
            },
            &w,
            &b,
            &r,
            &p.links,
        );
        assert!(!next.can_publish());
        assert!(next.findings.iter().any(|f| f.code == "humanEdit"));
        let mut b = b.clone();
        let duplicate = b.sheets[0].rows[0].clone();
        b.sheets[0].rows.push(duplicate);
        assert!(
            normalize(&b, &r.mapping)
                .1
                .iter()
                .any(|f| f.code == "duplicateKey")
        );
    }
    #[test]
    fn overload_includes_leave_without_erasing_source_effort() {
        let (org, b, mut r, mut w) = fixture("40");
        let p = evaluate(
            ReconcileContext {
                org_id: org,
                org_revision: 0,
                source_version: 0,
                role: Role::Owner,
            },
            &w,
            &b,
            &r,
            &[],
        );
        w.people = vec![p.people[0].person.clone()];
        w.projects = p.projects.clone();
        r.people[0].id = Some(w.people[0].id);
        r.projects[0].id = Some(w.projects[0].id);
        w.absences = vec![kivo_planning::Absence {
            id: Uuid::new_v4(),
            org_id: org,
            person_id: Some(w.people[0].id),
            category: "timeOff".into(),
            title: "Leave".into(),
            start: p.additions[0].start,
            end: p.additions[0].start,
            daily_minutes: None,
            version: 1,
        }];
        let p = evaluate(
            ReconcileContext {
                org_id: org,
                org_revision: 2,
                source_version: 0,
                role: Role::Owner,
            },
            &w,
            &b,
            &r,
            &[],
        );
        assert!(p.can_publish());
        assert_eq!(p.total_minutes, 2400);
        assert_eq!(p.capacity[0].available_minutes, 0);
        assert_eq!(p.capacity[0].planned_minutes, 480);
        assert_eq!(p.capacity[0].absence_ids, vec![w.absences[0].id]);
        assert!(p.findings.iter().any(|f| f.code == "overload"));
    }
}
