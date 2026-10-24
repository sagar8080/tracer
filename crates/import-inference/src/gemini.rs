use super::*;
pub(super) async fn suggest(adapter: &Adapters, e: &Entry, input: &str) -> Result<String, Error> {
    let value=adapter.send(adapter.client.post(format!("{}/v1beta/models/{}:generateContent",e.origin,e.model)).header("x-goog-api-key",&e.key).json(&json!({"systemInstruction":{"parts":[{"text":INSTRUCTION}]},"contents":[{"role":"user","parts":[{"text":input}]}],"generationConfig":{"maxOutputTokens":2000,"responseMimeType":"application/json","responseJsonSchema":schema()}}))).await?;
    let candidate = &value["candidates"][0];
    if candidate["finishReason"] != "STOP" {
        return Err(Error::Invalid("Gemini mapping was blocked or incomplete"));
    }
    let mut text = String::new();
    for part in candidate["content"]["parts"]
        .as_array()
        .ok_or(Error::Invalid("Gemini mapping is missing"))?
    {
        if part["thought"] != true
            && let Some(s) = part["text"].as_str()
        {
            text.push_str(s);
        }
    }
    Ok(text)
}
