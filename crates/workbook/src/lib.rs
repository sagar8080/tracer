//! Bounded workbook decoding. Original bytes are retained separately in private storage.
use calamine::{Data, Reader, Xlsx};
use kivo_integrations::*;
use quick_xml::events::Event;
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};

pub fn parse(filename: &str, bytes: &[u8]) -> Result<Workbook, Error> {
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
        return Err(Error::Invalid("Workbooks must contain 1 byte to 10 MiB"));
    }
    let mut book = Workbook {
        sheets: vec![],
        findings: vec![],
        suggestion: None,
        suggestion_provider: Provider::Manual,
        fingerprint: format!("{:x}", Sha256::digest(bytes)),
    };
    if filename.to_ascii_lowercase().ends_with(".csv") {
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(false)
            .flexible(false)
            .from_reader(bytes);
        let mut rows = Vec::new();
        for (r, record) in reader.records().enumerate() {
            if r > MAX_ROWS {
                return Err(Error::Invalid(
                    "A worksheet may contain at most 2,000 data rows",
                ));
            }
            let record = record.map_err(|_| {
                Error::Invalid("CSV rows must be UTF-8 and have consistent column counts")
            })?;
            if record.len() > MAX_COLUMNS {
                return Err(Error::Invalid("A worksheet may contain at most 64 columns"));
            }
            rows.push(
                record
                    .iter()
                    .enumerate()
                    .map(|(c, v)| Cell {
                        reference: format!("CSV!{}{}", column(c), r + 1),
                        value: v.trim_start_matches('\u{feff}').to_owned(),
                        formula: false,
                    })
                    .collect::<Vec<_>>(),
            );
        }
        let headers = if rows.is_empty() {
            vec![]
        } else {
            rows.remove(0)
        };
        book.sheets.push(Sheet {
            merged: false,
            name: "CSV".into(),
            headers,
            rows,
        });
    } else if filename.to_ascii_lowercase().ends_with(".xlsx") {
        preflight(bytes, &mut book.findings)?;
        let mut reader: Xlsx<_> = Xlsx::new(Cursor::new(bytes))
            .map_err(|_| Error::Invalid("This is not a supported XLSX workbook"))?;
        reader
            .load_merged_regions()
            .map_err(|_| Error::Invalid("Worksheet merge metadata could not be read"))?;
        let names = reader.sheet_names().to_vec();
        if names.len() > MAX_SHEETS {
            return Err(Error::Invalid(
                "A workbook may contain at most eight worksheets",
            ));
        }
        for name in names {
            let merged = !reader.merged_regions_by_sheet(&name).is_empty();
            let range = reader
                .worksheet_range(&name)
                .map_err(|_| Error::Invalid("A worksheet could not be read"))?;
            if range.is_empty() {
                book.sheets.push(Sheet {
                    merged,
                    name,
                    headers: vec![],
                    rows: vec![],
                });
                continue;
            }
            let (height, width) = range.get_size();
            if height > MAX_ROWS + 1 || width > MAX_COLUMNS {
                return Err(Error::Invalid(
                    "A worksheet exceeds the 2,000-row or 64-column limit",
                ));
            }
            let formulas = reader
                .worksheet_formula(&name)
                .map_err(|_| Error::Invalid("Worksheet formula lineage could not be read"))?;
            let (r0, c0) = range
                .start()
                .ok_or(Error::Invalid("Worksheet has no data"))?;
            let mut rows = Vec::new();
            for (r, values) in range.rows().enumerate() {
                let mut row = Vec::new();
                for (c, value) in values.iter().enumerate() {
                    let position = (r0 + r as u32, c0 + c as u32);
                    let value = match value {
                        Data::Empty => String::new(),
                        Data::DateTime(v) => v
                            .as_datetime()
                            .map(|v| v.date().to_string())
                            .ok_or(Error::Invalid("Invalid Excel date"))?,
                        Data::DateTimeIso(v) => v.split('T').next().unwrap_or(v).to_owned(),
                        Data::Error(_) => {
                            return Err(Error::Invalid(
                                "Resolve spreadsheet error cells before importing",
                            ));
                        }
                        v => v.to_string(),
                    };
                    row.push(Cell {
                        reference: format!(
                            "{}!{}{}",
                            name,
                            column(position.1 as usize),
                            position.0 + 1
                        ),
                        value,
                        formula: formulas.get_value(position).is_some_and(|s| !s.is_empty()),
                    });
                }
                rows.push(row);
            }
            let headers = rows.remove(0);
            book.sheets.push(Sheet {
                merged,
                name,
                headers,
                rows,
            });
        }
    } else {
        return Err(Error::Invalid(
            "Upload a CSV or XLSX file. Macros and legacy XLS files are unsupported",
        ));
    }
    let cells: Vec<_> = book
        .sheets
        .iter()
        .flat_map(|s| s.headers.iter().chain(s.rows.iter().flatten()))
        .collect();
    if cells.len() > MAX_CELLS
        || cells.iter().any(|c| c.value.len() > 1_000)
        || cells.iter().map(|c| c.value.len()).sum::<usize>() > 4 * 1024 * 1024
    {
        return Err(Error::Invalid(
            "Workbook exceeds the 64,000-cell or cell-text limit",
        ));
    }
    if cells.iter().any(|c| c.formula) {
        book.findings.push(Finding::warning(
            "cachedFormulas",
            "Formula cells use saved cached results; Kivo does not recalculate the workbook.",
        ));
    }
    book.suggestion = deterministic_hint(&book);
    Ok(book)
}
fn preflight(bytes: &[u8], findings: &mut Vec<Finding>) -> Result<(), Error> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| Error::Invalid("Invalid XLSX archive"))?;
    if zip.len() > 256 {
        return Err(Error::Invalid("XLSX archive has too many entries"));
    }
    let mut expanded = 0_u64;
    let mut cells = 0_usize;
    for i in 0..zip.len() {
        let mut file = zip
            .by_index(i)
            .map_err(|_| Error::Invalid("Invalid XLSX archive entry"))?;
        expanded = expanded
            .checked_add(file.size())
            .ok_or(Error::Invalid("XLSX expansion limit exceeded"))?;
        if expanded > MAX_EXPANDED_BYTES {
            return Err(Error::Invalid("XLSX may expand to at most 32 MiB"));
        }
        if file.name().to_ascii_lowercase().contains("vbaproject") {
            return Err(Error::Invalid("Macro-enabled workbooks are unsupported"));
        }
        if file.name().starts_with("xl/worksheets/") && file.name().ends_with(".xml") {
            let mut xml = Vec::new();
            file.by_ref()
                .take(MAX_EXPANDED_BYTES + 1)
                .read_to_end(&mut xml)
                .map_err(|_| Error::Invalid("Could not decode worksheet"))?;
            if xml.len() as u64 > MAX_EXPANDED_BYTES {
                return Err(Error::Invalid("Worksheet expansion limit exceeded"));
            }
            let mut reader = quick_xml::Reader::from_reader(xml.as_slice());
            loop {
                match reader
                    .read_event()
                    .map_err(|_| Error::Invalid("Invalid worksheet XML"))?
                {
                    Event::Start(e) | Event::Empty(e) => {
                        if e.local_name().as_ref() == b"mergeCell" {
                            findings.push(Finding::warning("mergedCells","Some worksheets contain merged cells; select an unmerged worksheet. The original workbook is retained."));
                        }
                        if e.local_name().as_ref() == b"c" {
                            cells += 1;
                            if cells > MAX_CELLS {
                                return Err(Error::Invalid("Workbook cell limit exceeded"));
                            }
                            for attr in e.attributes() {
                                let attr =
                                    attr.map_err(|_| Error::Invalid("Invalid worksheet cell"))?;
                                if attr.key.as_ref() == b"r" {
                                    let address = std::str::from_utf8(&attr.value)
                                        .map_err(|_| Error::Invalid("Invalid cell address"))?;
                                    let (col, row) = position(address)
                                        .ok_or(Error::Invalid("Invalid cell address"))?;
                                    if col >= MAX_COLUMNS || row > MAX_ROWS + 100 {
                                        return Err(Error::Invalid(
                                            "Worksheet cell lies outside supported bounds",
                                        ));
                                    }
                                }
                            }
                        }
                    }
                    Event::Eof => break,
                    _ => (),
                }
            }
        }
    }
    Ok(())
}
fn position(s: &str) -> Option<(usize, usize)> {
    let split = s.find(|c: char| c.is_ascii_digit())?;
    let mut col = 0_usize;
    for c in s[..split].bytes() {
        if !c.is_ascii_uppercase() {
            return None;
        }
        col = col.checked_mul(26)?.checked_add((c - b'A' + 1) as usize)?;
    }
    Some((col.checked_sub(1)?, s[split..].parse().ok()?))
}
fn column(mut n: usize) -> String {
    let mut s = String::new();
    loop {
        s.insert(0, (b'A' + (n % 26) as u8) as char);
        if n < 26 {
            break;
        }
        n = n / 26 - 1;
    }
    s
}
pub fn deterministic_hint(book: &Workbook) -> Option<MappingHint> {
    for (sheet, s) in book.sheets.iter().enumerate() {
        let normalized: Vec<_> = s
            .headers
            .iter()
            .map(|c| c.value.to_lowercase().replace([' ', '_', '-'], ""))
            .collect();
        let find = |names: &[&str]| {
            let hits: Vec<_> = normalized
                .iter()
                .enumerate()
                .filter(|(_, v)| names.contains(&v.as_str()))
                .map(|(i, _)| i)
                .collect();
            if hits.len() == 1 { Some(hits[0]) } else { None }
        };
        let (Some(person), Some(project)) = (
            find(&["person", "employee", "name", "resource"]),
            find(&["project", "projectname"]),
        ) else {
            continue;
        };
        let (start, end, effort) = (
            find(&["start", "startdate"]),
            find(&["end", "enddate"]),
            find(&[
                "hours",
                "effort",
                "hoursperday",
                "totalhours",
                "minutesperday",
            ]),
        );
        let weeks = s
            .headers
            .iter()
            .enumerate()
            .filter(|(_, c)| parse_date(&c.value, DateOrder::Iso).is_some())
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        let layout = if start.is_some() && end.is_some() && effort.is_some() {
            Layout::Tabular
        } else if !weeks.is_empty() {
            Layout::Weekly
        } else {
            continue;
        };
        let unit =
            if layout == Layout::Weekly || effort.is_some_and(|i| normalized[i] == "totalhours") {
                Unit::TotalHours
            } else if effort.is_some_and(|i| normalized[i] == "minutesperday") {
                Unit::MinutesPerDay
            } else {
                Unit::HoursPerDay
            };
        return Some(MappingHint {
            sheet,
            layout,
            person,
            project,
            start,
            end,
            effort,
            row_key: find(&["id", "rowid", "allocationid"]),
            weeks: if layout == Layout::Weekly {
                weeks
            } else {
                vec![]
            },
            unit,
            date_order: DateOrder::Iso,
        });
    }
    None
}
/// Pinned publication snapshot, neutralized spreadsheet formulas; source refs retained.
pub fn export_csv(import: &Import) -> Result<Vec<u8>, Error> {
    let preview = import
        .preview
        .as_ref()
        .ok_or(Error::Invalid("Publish an import before exporting"))?;
    let mut w = csv::Writer::from_writer(Vec::new());
    w.write_record([
        "Assignment ID",
        "Person",
        "Project",
        "Person ID",
        "Project ID",
        "Task",
        "Start",
        "End",
        "Minutes per day",
        "Source cells",
        "Published revision",
    ])
    .map_err(|_| Error::Unavailable)?;
    for l in &preview.links {
        let a = &l.assignment;
        let safe = |s: &str| {
            if s.trim_start().starts_with(['=', '+', '-', '@', '\t', '\r']) {
                format!("'{s}")
            } else {
                s.to_owned()
            }
        };
        w.write_record([
            a.id.to_string(),
            safe(&l.person_name),
            safe(&l.project_name),
            a.person_id.to_string(),
            a.project_id.to_string(),
            safe(&a.title),
            a.start.to_string(),
            a.end.to_string(),
            a.daily_minutes.to_string(),
            safe(&l.cells.join("; ")),
            import
                .published_revision
                .unwrap_or(preview.org_revision)
                .to_string(),
        ])
        .map_err(|_| Error::Unavailable)?;
    }
    w.into_inner().map_err(|_| Error::Unavailable)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_two_layouts_and_keeps_cell_lineage() {
        let book = parse(
            "plan.csv",
            b"Person,Project,Start,End,Hours per day\nAda,Launch,2026-10-12,2026-10-16,4\n",
        )
        .expect("fixture");
        let m = Mapping {
            columns: book.suggestion.clone().expect("mapping"),
            accept_cached_formulas: false,
            accept_calendar_defaults: false,
        };
        let (rows, findings) = normalize(&book, &m);
        assert_eq!(rows[0].minutes, 240);
        assert_eq!(rows[0].cells[0], "CSV!A2");
        assert!(findings.is_empty());
        let book = parse(
            "weekly.csv",
            b"Person,Project,2026-10-12,2026-10-19\nAda,Launch,20,10\n",
        )
        .expect("fixture");
        let m = Mapping {
            columns: book.suggestion.clone().expect("mapping"),
            accept_cached_formulas: false,
            accept_calendar_defaults: false,
        };
        let (rows, findings) = normalize(&book, &m);
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.total));
        assert!(findings.is_empty());
    }
    #[test]
    fn rejects_malformed_and_unsupported_workbooks() {
        assert!(parse("plan.xlsm", b"macro").is_err());
        assert!(parse("plan.csv", b"a,b\nc\n").is_err());
        assert!(parse("plan.xlsx", b"not a zip").is_err());
    }
}

#[cfg(test)]
mod xlsx_tests;
