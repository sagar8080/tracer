use crate::*;
use chrono::{Datelike, Duration, NaiveDate};
use std::collections::BTreeSet;

pub fn parse_date(value: &str, order: DateOrder) -> Option<NaiveDate> {
    let s = value.trim();
    let format = if s.len() == 10 && s.as_bytes().get(4) == Some(&b'-') {
        "%Y-%m-%d"
    } else {
        match order {
            DateOrder::Iso => return None,
            DateOrder::Mdy => "%m/%d/%Y",
            DateOrder::Dmy => "%d/%m/%Y",
        }
    };
    let date = NaiveDate::parse_from_str(s, format).ok()?;
    (2000..=2100).contains(&date.year()).then_some(date)
}
/// Decimal string arithmetic; reject negative, nonfinite, currency and quarter-minute rounding.
pub fn effort_minutes(value: &str, unit: Unit) -> Option<i32> {
    let s = value.trim();
    let (whole, fraction) = s.split_once('.').unwrap_or((s, ""));
    if whole.is_empty()
        || fraction.len() > 4
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|v| v.is_ascii_digit())
    {
        return None;
    }
    let scale = 10_i64.pow(fraction.len() as u32);
    let n = whole
        .parse::<i64>()
        .ok()?
        .checked_mul(scale)?
        .checked_add(if fraction.is_empty() {
            0
        } else {
            fraction.parse().ok()?
        })?;
    let minutes = n.checked_mul(if unit == Unit::MinutesPerDay { 1 } else { 60 })?;
    if minutes % scale != 0 {
        return None;
    }
    i32::try_from(minutes / scale)
        .ok()
        .filter(|n| *n > 0 && *n % 15 == 0 && *n <= 527_040)
}
fn bad(findings: &mut Vec<Finding>, code: &str, message: &str, cell: Option<&Cell>) {
    findings.push(Finding::block(
        code,
        message,
        cell.map(|c| c.reference.clone()),
    ));
}
pub fn normalize(book: &Workbook, mapping: &Mapping) -> (Vec<SourceRow>, Vec<Finding>) {
    let c = &mapping.columns;
    let mut findings = book.findings.clone();
    let Some(sheet) = book.sheets.get(c.sheet) else {
        bad(&mut findings, "sheet", "Choose a worksheet", None);
        return (vec![], findings);
    };
    if sheet.merged {
        bad(
            &mut findings,
            "mergedCells",
            "The selected worksheet has merged cells. Choose an unmerged worksheet or supply a values-only copy",
            None,
        );
    }
    let mut used = vec![c.person, c.project];
    match c.layout {
        Layout::Tabular => {
            if let (Some(s), Some(e), Some(h)) = (c.start, c.end, c.effort) {
                used.extend([s, e, h]);
            } else {
                bad(
                    &mut findings,
                    "columns",
                    "Choose start, end and effort columns",
                    None,
                );
            }
        }
        Layout::Weekly => {
            if c.weeks.is_empty() || c.unit != Unit::TotalHours {
                bad(
                    &mut findings,
                    "weeks",
                    "Select dated weekly columns and total hours",
                    None,
                );
            }
            used.extend(&c.weeks);
        }
    }
    if let Some(key) = c.row_key {
        used.push(key);
    }
    if used.iter().any(|i| *i >= sheet.headers.len())
        || used.iter().collect::<BTreeSet<_>>().len() != used.len()
    {
        bad(
            &mut findings,
            "columns",
            "Mapped columns must exist and have distinct meanings",
            None,
        );
    }
    if findings.iter().any(|f| f.severity == Severity::Block) {
        return (vec![], findings);
    }
    let mut rows = Vec::new();
    let mut keys = BTreeSet::new();
    for row in &sheet.rows {
        let get = |i: usize| row.get(i);
        let text = |i: usize| get(i).map(|v| v.value.trim()).unwrap_or("");
        if used.iter().all(|i| text(*i).is_empty()) {
            continue;
        }
        for index in &used {
            if let Some(cell) = get(*index)
                && cell.formula
                && !mapping.accept_cached_formulas
            {
                bad(
                    &mut findings,
                    "formula",
                    "Acknowledge cached formula values or supply values-only cells",
                    Some(cell),
                );
            }
        }
        let person = text(c.person);
        let project = text(c.project);
        if person.is_empty()
            || project.is_empty()
            || person.chars().count() > 100
            || project.chars().count() > 100
        {
            bad(
                &mut findings,
                "identity",
                "Every allocation needs person and project names of 1–100 characters",
                get(c.person),
            );
            continue;
        }
        let mut add = |start: Option<NaiveDate>, end: Option<NaiveDate>, effort: usize| {
            if c.layout == Layout::Weekly
                && start.is_some_and(|d| d.weekday().num_days_from_monday() != 0)
            {
                bad(
                    &mut findings,
                    "weekStart",
                    "Weekly columns must be dated Mondays",
                    sheet.headers.get(effort),
                );
                return;
            }
            let Some(start) = start else {
                bad(
                    &mut findings,
                    "date",
                    "Choose an explicit date order or use YYYY-MM-DD",
                    get(c.start.unwrap_or(effort)),
                );
                return;
            };
            let Some(end) = end else {
                bad(
                    &mut findings,
                    "date",
                    "An end date is missing or invalid",
                    get(c.end.unwrap_or(effort)),
                );
                return;
            };
            if end < start || (end - start).num_days() > 366 {
                bad(
                    &mut findings,
                    "dateRange",
                    "Dates must form an inclusive range of at most 367 days",
                    get(effort),
                );
                return;
            }
            let Some(minutes) = effort_minutes(text(effort), c.unit) else {
                bad(
                    &mut findings,
                    "effort",
                    "Effort must be positive hours/minutes in exact quarter-hour increments",
                    get(effort),
                );
                return;
            };
            let base_key = c.row_key.map(&text).filter(|s| !s.is_empty());
            if c.row_key.is_some() && base_key.is_none() {
                bad(
                    &mut findings,
                    "rowKey",
                    "Every allocation needs a stable row key",
                    get(c.row_key.unwrap_or(c.person)),
                );
                return;
            }
            let key = if let Some(key) = base_key {
                if c.layout == Layout::Weekly {
                    format!("{key}|{start}")
                } else {
                    key.into()
                }
            } else {
                format!(
                    "{}:{}|{}:{}|{start}|{end}",
                    person.len(),
                    person,
                    project.len(),
                    project
                )
            };
            if key.len() > 400 || !keys.insert(key.clone()) {
                bad(
                    &mut findings,
                    "duplicateKey",
                    "Duplicate source allocation. Supply a unique row key column",
                    get(effort),
                );
                return;
            }
            rows.push(SourceRow {
                key,
                person: person.into(),
                project: project.into(),
                start,
                end,
                minutes,
                total: c.unit == Unit::TotalHours,
                cells: used
                    .iter()
                    .filter_map(|i| get(*i).map(|v| v.reference.clone()))
                    .collect(),
            });
        };
        match c.layout {
            Layout::Tabular => add(
                c.start.and_then(|i| parse_date(text(i), c.date_order)),
                c.end.and_then(|i| parse_date(text(i), c.date_order)),
                c.effort.unwrap_or(0),
            ),
            Layout::Weekly => {
                for i in &c.weeks {
                    let effort = text(*i);
                    let zero = effort.contains('0')
                        && effort.bytes().filter(|b| *b != b'.').all(|b| b == b'0')
                        && effort.bytes().filter(|b| *b == b'.').count() <= 1;
                    if effort.is_empty() || zero {
                        continue;
                    }
                    let date = parse_date(&sheet.headers[*i].value, c.date_order);
                    add(
                        date,
                        date.and_then(|d| d.checked_add_signed(Duration::days(6))),
                        *i,
                    );
                }
            }
        }
    }
    if rows.is_empty() {
        bad(&mut findings, "empty", "No allocations could be read", None);
    }
    if rows.len() > MAX_ROWS {
        bad(
            &mut findings,
            "rowLimit",
            "An import may contain at most 2,000 allocations",
            None,
        );
        rows.clear();
    }
    (rows, findings)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dates_and_effort_never_guess_or_round() {
        assert!(parse_date("10/12/2026", DateOrder::Iso).is_none());
        assert_ne!(
            parse_date("10/12/2026", DateOrder::Mdy),
            parse_date("10/12/2026", DateOrder::Dmy)
        );
        assert_eq!(effort_minutes("1.25", Unit::TotalHours), Some(75));
        for v in [
            "1.01",
            "NaN",
            "-8",
            "$40",
            "2e4",
            "99999999999999999999999999",
        ] {
            assert!(effort_minutes(v, Unit::TotalHours).is_none());
        }
    }
}
