use super::*;
pub(super) async fn suggest(adapter: &Adapters, e: &Entry, input: &str) -> Result<String, Error> {
    let value=adapter.send(adapter.client.post(format!("{}/v1/responses",e.origin)).bearer_auth(&e.key).json(&json!({"model":e.model,"store":false,"max_output_tokens":2000,"input":[{"role":"system","content":INSTRUCTION},{"role":"user","content":input}],"text":{"format":{"type":"json_schema","name":"workbook_mapping","strict":true,"schema":schema()}}}))).await?;
    if value["status"] != "completed" {
        return Err(Error::Invalid("OpenAI mapping was refused or incomplete"));
    }
    let blocks = value["output"]
        .as_array()
        .ok_or(Error::Invalid("OpenAI mapping is missing"))?;
    let mut text = String::new();
    for block in blocks {
        if let Some(parts) = block["content"].as_array() {
            for part in parts {
                match part["type"].as_str() {
                    Some("refusal") => {
                        return Err(Error::Invalid("OpenAI refused the mapping request"));
                    }
                    Some("output_text") => text.push_str(
                        part["text"]
                            .as_str()
                            .ok_or(Error::Invalid("OpenAI mapping text is missing"))?,
                    ),
                    _ => (),
                }
            }
        }
    }
    Ok(text)
}
