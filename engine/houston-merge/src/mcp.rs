//! Minimal MCP JSON-RPC client over HTTP for Merge Agent Handler.
//!
//! The MCP spec uses Streamable HTTP — POST requests with a JSON-RPC envelope
//! and either an `application/json` response or a Server-Sent Events stream.
//! For our needs (tools/list + tools/call without streaming partial deltas) we
//! handle both cases uniformly: parse `data: ...` lines if SSE, fall back to a
//! direct JSON body otherwise.
//!
//! Auth is bearer-token via [`crate::auth::valid_access_token`] — the caller
//! supplies a token they obtained from the auth module.

use serde::{Deserialize, Serialize};

use crate::MergeEndpoints;

/// One tool exposed by the Merge MCP server. We only model the fields the UI
/// + agents actually need.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Connector slug the tool belongs to (parsed from the tool name prefix
    /// when Merge uses `<connector>_<action>` naming). None if we can't infer.
    #[serde(default)]
    pub connector: Option<String>,
}

/// Discover available tools at the MCP endpoint.
pub async fn list_tools(
    endpoints: &MergeEndpoints,
    bearer_token: &str,
) -> Result<Vec<McpTool>, McpError> {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
        "params": {}
    });
    let text = call(endpoints, bearer_token, body).await?;
    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| McpError::ParseJson(format!("tools/list: {e}")))?;
    let arr = parsed
        .pointer("/result/tools")
        .and_then(|v| v.as_array())
        .ok_or_else(|| McpError::ParseJson("missing result.tools".into()))?;

    Ok(arr
        .iter()
        .filter_map(|t| {
            let name = t.get("name")?.as_str()?.to_string();
            let description = t
                .get("description")
                .and_then(|d| d.as_str())
                .unwrap_or_default()
                .to_string();
            let connector = name.split('_').next().map(|s| s.to_string());
            Some(McpTool {
                name,
                description,
                connector,
            })
        })
        .collect())
}

/// Invoke a tool by name with arbitrary JSON arguments. Returns the raw `result`
/// payload as a JSON value.
pub async fn call_tool(
    endpoints: &MergeEndpoints,
    bearer_token: &str,
    tool_name: &str,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, McpError> {
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": { "name": tool_name, "arguments": arguments }
    });
    let text = call(endpoints, bearer_token, body).await?;
    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| McpError::ParseJson(format!("tools/call: {e}")))?;
    Ok(parsed
        .get("result")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
}

async fn call(
    endpoints: &MergeEndpoints,
    bearer_token: &str,
    body: serde_json::Value,
) -> Result<String, McpError> {
    let resp = reqwest::Client::new()
        .post(endpoints.mcp)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("Authorization", format!("Bearer {bearer_token}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| McpError::Http(format!("send: {e}")))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| McpError::Http(format!("body: {e}")))?;

    if status.as_u16() == 401 {
        return Err(McpError::Unauthorized);
    }
    if status.as_u16() == 403 {
        return Err(McpError::Forbidden(body));
    }
    if !status.is_success() {
        return Err(McpError::Http(format!("status={status} body={body}")));
    }

    // SSE responses look like `data: { ... }\n\n`. Plain JSON responses are bare
    // JSON. Handle both: prefer the first `data:` line if present, otherwise
    // return the body verbatim.
    if let Some(line) = body.lines().find(|l| l.starts_with("data: ")) {
        return Ok(line[6..].to_string());
    }
    Ok(body)
}

#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("http: {0}")]
    Http(String),
    #[error("401 unauthorized")]
    Unauthorized,
    #[error("403 forbidden: {0}")]
    Forbidden(String),
    #[error("parse json: {0}")]
    ParseJson(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connector_inferred_from_tool_name_prefix() {
        let raw = serde_json::json!({
            "jsonrpc": "2.0",
            "result": {
                "tools": [
                    {"name": "gmail_send_email", "description": "Send an email"},
                    {"name": "slack_post_message", "description": "Post a message"},
                    {"name": "calendar_list_events", "description": "List events"}
                ]
            }
        });
        let tools: Vec<McpTool> = raw
            .pointer("/result/tools")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|t| {
                let name = t.get("name").unwrap().as_str().unwrap().to_string();
                let description = t.get("description").unwrap().as_str().unwrap().to_string();
                let connector = name.split('_').next().map(|s| s.to_string());
                McpTool {
                    name,
                    description,
                    connector,
                }
            })
            .collect();
        assert_eq!(tools[0].connector.as_deref(), Some("gmail"));
        assert_eq!(tools[1].connector.as_deref(), Some("slack"));
        assert_eq!(tools[2].connector.as_deref(), Some("calendar"));
    }
}
