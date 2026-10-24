use super::*;
pub(super) async fn suggest(adapter: &Adapters, e: &Entry, input: &str) -> Result<String, Error> {
    let value=adapter.send(adapter.client.post(format!("{}/v1/messages",e.origin)).header("x-api-key",&e.key).header("anthropic-version","2023-06-01").json(&json!({"model":e.model,"max_tokens":2000,"system":INSTRUCTION,"messages":[{"role":"user","content":input}],"output_config":{"format":{"type":"json_schema","schema":schema()}}}))).await?;
    if value["stop_reason"] != "end_turn" {
        return Err(Error::Invalid("Claude mapping was refused or incomplete"));
    }
    let mut text = String::new();
    for part in value["content"]
        .as_array()
        .ok_or(Error::Invalid("Claude mapping is missing"))?
    {
        if part["type"] == "text" {
            text.push_str(
                part["text"]
                    .as_str()
                    .ok_or(Error::Invalid("Claude mapping text is missing"))?,
            );
        }
    }
    Ok(text)
}
