use super::*;
use std::io::Write;
fn workbook(sheet: &str, extra: Option<(&str, Vec<u8>)>) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let files = [
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
        ),
        (
            "_rels/.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        ),
        (
            "xl/workbook.xml",
            r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Plan" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
        ),
        ("xl/worksheets/sheet1.xml", sheet),
    ];
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, data) in files {
        w.start_file(name, options).expect("entry");
        w.write_all(data.as_bytes()).expect("bytes");
    }
    if let Some((name, data)) = extra {
        w.start_file(name, options).expect("entry");
        w.write_all(&data).expect("bytes");
    }
    w.finish().expect("archive").into_inner()
}
fn text(ref_: &str, value: &str) -> String {
    format!(r#"<c r="{ref_}" t="inlineStr"><is><t>{value}</t></is></c>"#)
}
fn sheet(formula: bool, merge: bool) -> String {
    let h = ["Person", "Project", "Start", "End", "Hours per day"]
        .iter()
        .enumerate()
        .map(|(i, v)| text(&format!("{}3", column(i)), v))
        .collect::<String>();
    let row = [
        ("A4", "Ada"),
        ("B4", "Launch"),
        ("C4", "2026-10-12"),
        ("D4", "2026-10-16"),
    ]
    .iter()
    .map(|(r, v)| text(r, v))
    .collect::<String>();
    format!(
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="3">{h}</row><row r="4">{row}<c r="E4">{}<v>4</v></c></row></sheetData>{}</worksheet>"#,
        if formula { "<f>2+2</f>" } else { "" },
        if merge {
            r#"<mergeCells count="1"><mergeCell ref="A3:B3"/></mergeCells>"#
        } else {
            ""
        }
    )
}
#[test]
fn xlsx_preserves_offset_cells_and_requires_formula_acknowledgement() {
    let b = parse("plan.xlsx", &workbook(&sheet(true, false), None)).expect("xlsx");
    assert_eq!(b.sheets[0].headers[0].reference, "Plan!A3");
    assert!(b.sheets[0].rows[0][4].formula);
    let mut m = Mapping {
        columns: b.suggestion.clone().expect("mapping"),
        accept_cached_formulas: false,
        accept_calendar_defaults: true,
    };
    assert!(normalize(&b, &m).1.iter().any(|f| f.code == "formula"));
    m.accept_cached_formulas = true;
    let (rows, findings) = normalize(&b, &m);
    assert_eq!(rows[0].minutes, 240);
    assert!(!findings.iter().any(|f| f.severity == Severity::Block));
}
#[test]
fn merged_cells_macros_huge_expansion_and_sparse_bounds_are_not_silently_imported() {
    let b = parse("plan.xlsx", &workbook(&sheet(false, true), None)).expect("xlsx");
    assert!(b.findings.iter().any(|f| f.code == "mergedCells"));
    assert!(b.sheets[0].merged);
    let mapping = Mapping {
        columns: b.suggestion.clone().expect("mapping"),
        accept_cached_formulas: true,
        accept_calendar_defaults: true,
    };
    assert!(
        normalize(&b, &mapping)
            .1
            .iter()
            .any(|f| f.code == "mergedCells" && f.severity == Severity::Block)
    );
    let mut mixed = b.clone();
    let mut clean = mixed.sheets[0].clone();
    clean.merged = false;
    clean.name = "Values".into();
    mixed.sheets.push(clean);
    let mut mapping = mapping;
    mapping.columns.sheet = 1;
    assert!(
        !normalize(&mixed, &mapping)
            .1
            .iter()
            .any(|f| f.severity == Severity::Block)
    );

    assert!(
        parse(
            "plan.xlsx",
            &workbook(&sheet(false, false), Some(("xl/vbaProject.bin", vec![1])))
        )
        .is_err()
    );
    assert!(
        parse(
            "plan.xlsx",
            &workbook(
                &sheet(false, false),
                Some(("xl/bomb.xml", vec![0; MAX_EXPANDED_BYTES as usize + 1]))
            )
        )
        .is_err()
    );
    let sparse = sheet(false, false).replace("E4", "XFD1048576");
    assert!(parse("plan.xlsx", &workbook(&sparse, None)).is_err());
}
