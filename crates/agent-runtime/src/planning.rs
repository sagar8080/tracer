use crate::{Day, Error, Move, Window};
use kivo_planning::{Absence, Assignment, Person, WorkingCalendar};

pub struct CapacitySource {
    pub person: Person,
    pub calendars: Vec<WorkingCalendar>,
    pub absences: Vec<Absence>,
    pub assignments: Vec<Assignment>,
}
/// Plans accrue on working days even when leave removes available capacity.
pub fn day_series(
    source: &CapacitySource,
    window: &Window,
    replacement: Option<&Assignment>,
) -> Vec<Day> {
    window
        .start
        .iter_days()
        .take(93)
        .take_while(|d| *d <= window.end)
        .map(|date| {
            let base = kivo_planning::base_minutes_on(&source.person, date, &source.calendars);
            let capacity = kivo_planning::available_minutes_on(
                &source.person,
                date,
                &source.calendars,
                &source.absences,
            );
            let effort = |a: &Assignment| {
                if a.person_id == source.person.id
                    && a.status == "confirmed"
                    && a.start <= date
                    && a.end >= date
                    && base > 0
                {
                    a.daily_minutes
                } else {
                    0
                }
            };
            let mut planned: i32 = source
                .assignments
                .iter()
                .filter(|a| replacement.is_none_or(|r| r.id != a.id))
                .map(effort)
                .sum();
            if let Some(r) = replacement {
                planned += effort(r);
            }
            Day {
                date,
                capacity_minutes: capacity,
                planned_minutes: planned,
                overload_minutes: (planned - capacity).max(0),
            }
        })
        .collect()
}
pub fn checked_move(
    original: &Assignment,
    request: &Move,
    today: chrono::NaiveDate,
    project_active: bool,
) -> Result<(Assignment, Window), Error> {
    request.validate()?;
    if original.version != request.expected_version {
        return Err(Error::Conflict);
    }
    if !project_active {
        return Err(Error::Invalid("Choose an active project"));
    }
    if original.start < today || request.start < today {
        return Err(Error::Invalid(
            "A0 proposals move work from today onward only",
        ));
    }
    if original.end.signed_duration_since(original.start)
        != request.end.signed_duration_since(request.start)
    {
        return Err(Error::Invalid(
            "A move must preserve the allocation duration",
        ));
    }
    if original.person_id == request.person_id && original.start == request.start {
        return Err(Error::Invalid("Choose a different date or person"));
    }
    let window = Window {
        start: original.start.min(request.start),
        end: original.end.max(request.end),
        cursor: None,
    };
    window.validate().map_err(|_| {
        Error::Invalid("Original and proposed work must fit a 93-day comparison window")
    })?;
    let mut proposed = original.clone();
    proposed.person_id = request.person_id;
    proposed.start = request.start;
    proposed.end = request.end;
    Ok((proposed, window))
}
#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    #[test]
    fn moving_work_preserves_effort_and_leave_exposes_the_new_overload() {
        let org = Uuid::new_v4();
        let id = Uuid::new_v4();
        let monday = chrono::NaiveDate::from_ymd_opt(2026, 10, 12).expect("fixture");
        let person = Person {
            id,
            org_id: org,
            name: "Alex".into(),
            role: "Designer".into(),
            team: "Studio".into(),
            daily_minutes: 480,
            cost_rate: None,
            color: "sage".into(),
            version: 1,
        };
        let a = Assignment {
            id: Uuid::new_v4(),
            org_id: org,
            person_id: id,
            project_id: Uuid::new_v4(),
            title: "Plan".into(),
            start: monday,
            end: monday,
            daily_minutes: 600,
            status: "confirmed".into(),
            version: 1,
        };
        let request = Move {
            assignment_id: a.id,
            expected_version: 1,
            source_revision: 0,
            person_id: id,
            start: monday.succ_opt().expect("fixture"),
            end: monday.succ_opt().expect("fixture"),
            reason: "Client delay".into(),
        };
        let (candidate, window) = checked_move(&a, &request, monday, true).expect("fixture");
        let source = CapacitySource {
            person,
            calendars: vec![],
            assignments: vec![a.clone()],
            absences: vec![Absence {
                id: Uuid::new_v4(),
                org_id: org,
                person_id: Some(id),
                category: "timeOff".into(),
                title: "Private".into(),
                start: request.start,
                end: request.end,
                daily_minutes: Some(240),
                version: 1,
            }],
        };
        let before = day_series(&source, &window, None);
        let after = day_series(&source, &window, Some(&candidate));
        assert_eq!(before.iter().map(|d| d.planned_minutes).sum::<i32>(), 600);
        assert_eq!(after.iter().map(|d| d.planned_minutes).sum::<i32>(), 600);
        assert_eq!(before[0].overload_minutes, 120);
        assert_eq!(after[0].planned_minutes, 0);
        assert_eq!(after[1].overload_minutes, 360);
        let mut bad = request;
        bad.end = bad.end.succ_opt().expect("fixture");
        assert!(checked_move(&a, &bad, monday, true).is_err());
    }
}
