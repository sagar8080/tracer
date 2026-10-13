//! Stateless Streamable HTTP JSON-RPC adapter. Business contracts live in capability crates.
use crate::{AppState, agent_tools, error::ApiError};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use kivo_agent_runtime::{Command, Repository, Window};
use kivo_tenancy::{AgentCapability, Principal};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;
const VERSIONS: [&str; 3] = ["2025-11-25", "2025-06-18", "2025-03-26"];
fn rpc(id: Value, result: Value) -> Response {
    Json(json!({"jsonrpc":"2.0","id":id,"result":result})).into_response()
}
fn error(id: Value, code: i32, message: &str) -> Response {
    Json(json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})).into_response()
}
fn protocol(headers: &HeaderMap) -> Result<(), ApiError> {
    if let Some(v) = headers.get("mcp-protocol-version")
        && !v.to_str().ok().is_some_and(|s| VERSIONS.contains(&s))
    {
        return Err(ApiError::Invalid("Unsupported MCP protocol version"));
    }
    Ok(())
}
pub async fn no_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    agent_tools::caller(&headers, &state, org).await?;
    if protocol(&headers).is_err() {
        return Ok(StatusCode::BAD_REQUEST);
    }
    Ok(StatusCode::METHOD_NOT_ALLOWED)
}
fn tools(capabilities: &[AgentCapability]) -> Vec<Value> {
    let uuid = json!({"type":"string","format":"uuid"});
    let window = json!({"type":"object","additionalProperties":false,"properties":{"start":{"type":"string","format":"date"},"end":{"type":"string","format":"date"},"cursor":{"type":"string","format":"uuid"}},"required":["start","end"]});
    let mut result = Vec::new();
    let mut push = |name: &str, description: &str, schema: Value, read: bool| {
        result.push(json!({"name":name,"description":description,"inputSchema":schema,"annotations":{"readOnlyHint":read,"destructiveHint":false,"openWorldHint":false}}))
    };
    if capabilities.contains(&AgentCapability::ReadSchedule) {
        push(
            "kivo_schedule",
            "Read a bounded project-scoped schedule without financial fields. Follow nextCursor to obtain additional assignments.",
            window.clone(),
            true,
        );
    }
    if capabilities.contains(&AgentCapability::ReadCapacity) {
        let mut schema = window.clone();
        if let Some(properties) = schema["properties"].as_object_mut() {
            properties.remove("cursor");
        }
        schema["properties"]["personId"] = uuid.clone();
        schema["required"] = json!(["personId", "start", "end"]);
        push(
            "kivo_capacity",
            "Read aggregate capacity/load for a person in the delegated project team. Load includes other projects without revealing their identities or notes.",
            schema,
            true,
        );
    }
    if capabilities.contains(&AgentCapability::ReadProposal) {
        push(
            "kivo_proposals",
            "List this agent's proposals and their human review state. This does not execute proposals.",
            json!({"type":"object","additionalProperties":false,"properties":{"cursor":uuid.clone()}}),
            true,
        );
        push(
            "kivo_proposal",
            "Inspect one of this agent's proposals and its computed impact.",
            json!({"type":"object","additionalProperties":false,"properties":{"id":uuid.clone()},"required":["id"]}),
            true,
        );
    }
    if capabilities.contains(&AgentCapability::ProposeMove) {
        push(
            "kivo_propose_move",
            "Persist a reviewable future-assignment move. Supply a stable proposal UUID for idempotent retry and the schedule revision/version. A0 never changes the live schedule.",
            json!({"type":"object","additionalProperties":false,"properties":{"id":uuid.clone(),"request":{"type":"object","additionalProperties":false,"properties":{"assignmentId":uuid.clone(),"expectedVersion":{"type":"integer","minimum":1},"sourceRevision":{"type":"integer","minimum":0},"personId":uuid,"start":{"type":"string","format":"date"},"end":{"type":"string","format":"date"},"reason":{"type":"string","minLength":1,"maxLength":1000}},"required":["assignmentId","expectedVersion","sourceRevision","personId","start","end","reason"]}},"required":["id","request"]}),
            false,
        );
    }
    result
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CapacityInput {
    #[serde(rename = "personId")]
    person: Uuid,
    start: chrono::NaiveDate,
    end: chrono::NaiveDate,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IdInput {
    id: Uuid,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProposeInput {
    id: Uuid,
    request: kivo_agent_runtime::Move,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CursorInput {
    cursor: Option<Uuid>,
}
async fn call(
    state: &AppState,
    caller: Principal,
    org: Uuid,
    name: &str,
    args: Value,
) -> Result<Value, ApiError> {
    let invalid = || ApiError::Invalid("Invalid tool arguments");
    match name {
        "kivo_schedule" => {
            let input: Window = serde_json::from_value(args).map_err(|_| invalid())?;
            serde_json::to_value(state.database.schedule_window(caller, org, input).await?)
                .map_err(|_| invalid())
        }
        "kivo_capacity" => {
            let input: CapacityInput = serde_json::from_value(args).map_err(|_| invalid())?;
            serde_json::to_value(
                state
                    .database
                    .capacity_window(
                        caller,
                        org,
                        input.person,
                        Window {
                            start: input.start,
                            end: input.end,
                            cursor: None,
                        },
                    )
                    .await?,
            )
            .map_err(|_| invalid())
        }
        "kivo_proposals" => {
            let input: CursorInput = serde_json::from_value(args).map_err(|_| invalid())?;
            serde_json::to_value(state.database.proposals(caller, org, input.cursor).await?)
                .map_err(|_| invalid())
        }
        "kivo_proposal" => {
            let input: IdInput = serde_json::from_value(args).map_err(|_| invalid())?;
            serde_json::to_value(state.database.proposal(caller, org, input.id).await?)
                .map_err(|_| invalid())
        }
        "kivo_propose_move" => {
            let input: ProposeInput = serde_json::from_value(args).map_err(|_| invalid())?;
            serde_json::to_value(
                state
                    .database
                    .propose(
                        caller,
                        org,
                        Command::Propose {
                            id: input.id,
                            request: input.request,
                        },
                        input.id,
                    )
                    .await?,
            )
            .map_err(|_| invalid())
        }
        _ => Err(ApiError::Invalid("Unknown tool")),
    }
}
pub async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(org): Path<Uuid>,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    let caller = agent_tools::caller(&headers, &state, org).await?;
    if protocol(&headers).is_err() {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }
    let accept = headers
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !accept.contains("application/json") || !accept.contains("text/event-stream") {
        return Ok(StatusCode::NOT_ACCEPTABLE.into_response());
    }
    let id = body.get("id").cloned().unwrap_or(Value::Null);
    if body.get("jsonrpc").and_then(Value::as_str) != Some("2.0") || !body.is_object() {
        return Ok(error(id, -32600, "Invalid JSON-RPC request"));
    }
    let Some(method) = body.get("method").and_then(Value::as_str) else {
        return Ok(error(id, -32600, "Method is required"));
    };
    if body.get("id").is_none() {
        return Ok(StatusCode::ACCEPTED.into_response());
    }
    if !id.is_string() && !id.is_i64() && !id.is_u64() {
        return Ok(error(Value::Null, -32600, "Invalid request ID"));
    }
    let params = body.get("params").cloned().unwrap_or_else(|| json!({}));
    let result = match method {
        "initialize" => {
            if !params.get("protocolVersion").is_some_and(Value::is_string)
                || !params.get("capabilities").is_some_and(Value::is_object)
                || !params.get("clientInfo").is_some_and(Value::is_object)
            {
                return Ok(error(
                    id,
                    -32602,
                    "Initialization requires protocolVersion, capabilities and clientInfo",
                ));
            }
            let requested = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(VERSIONS[0]);
            let version = if VERSIONS.contains(&requested) {
                requested
            } else {
                VERSIONS[0]
            };
            rpc(
                id,
                json!({"protocolVersion":version,"capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"kivo-planning","version":"0.1.0"},"instructions":"Use scoped tools and preserve returned source versions. Proposals remain drafts; no A0 tool mutates the live schedule."}),
            )
        }
        "ping" => rpc(id, json!({})),
        "tools/list" => rpc(
            id,
            json!({"tools":tools(&state.database.capabilities(caller,org).await?)}),
        ),
        "tools/call" => {
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return Ok(error(id, -32602, "Tool name is required"));
            };
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match call(&state, caller, org, name, args).await {
                Ok(value) => rpc(
                    id,
                    json!({"content":[{"type":"text","text":value.to_string()}],"structuredContent":value,"isError":false}),
                ),
                Err(e) => rpc(
                    id,
                    json!({"content":[{"type":"text","text":e.to_string()}],"isError":true}),
                ),
            }
        }
        _ => error(id, -32601, "Method not found"),
    };
    Ok(result)
}
