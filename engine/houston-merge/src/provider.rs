//! [`IntegrationsProvider`] implementation for Merge Agent Handler.
//!
//! Builds on `auth.rs` (OAuth 2.0 + PKCE) and `mcp.rs` (MCP JSON-RPC).
//!
//! Two flows the trait demands that need extra plumbing:
//!
//! 1. **start_login → complete_login**: trait shape was designed for Composio's
//!    polling pattern (CLI returns a key, caller polls). For OAuth we instead
//!    spin up a local HTTP listener on `127.0.0.1:<port>/callback` BEFORE we
//!    return the authorization URL, then [`complete_login`] is a no-op (we
//!    already captured the auth code). The `completion_key` we return is the
//!    `state` token, which the caller passes back so we can match it to the
//!    pending flow stored in [`PENDING_LOGINS`].
//!
//! 2. **connect_app**: in Merge, app connections happen automatically the
//!    first time an agent invokes a tool that requires an unlinked app — the
//!    MCP server responds with a Magic Link URL. We expose this by calling
//!    a sentinel tool (`<connector>_describe` or similar) and surfacing the
//!    returned link. If Merge's actual API differs, the call site here changes
//!    but the trait surface stays stable.

use async_trait::async_trait;
use houston_integrations::{
    AppConnectionFlow, AppEntry, Connection, IntegrationsProvider, LoginFlow, McpEndpoint,
    ProviderError, ProviderId, ProviderResult, ProviderStatus,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::auth::{self, AuthError};
use crate::mcp;
use crate::MergeEndpoints;

/// Stored mid-flight login flows keyed by state token. Cleaned up on success
/// or on logout. In-process only — Houston runs as one engine subprocess per
/// user, so we don't need cross-process synchronization.
static PENDING_LOGINS: once_cell::sync::Lazy<
    Mutex<HashMap<String, PendingLoginState>>,
> = once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone)]
struct PendingLoginState {
    pkce_verifier: String,
    redirect_uri: String,
    client_id: String,
    /// Callback receiver — the local HTTP listener writes the captured code here.
    code_recv: Arc<tokio::sync::Mutex<Option<tokio::sync::oneshot::Receiver<String>>>>,
}

#[derive(Debug, Clone)]
pub struct MergeProvider {
    endpoints: Arc<MergeEndpoints>,
}

impl Default for MergeProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl MergeProvider {
    pub fn new() -> Self {
        Self {
            endpoints: Arc::new(MergeEndpoints::PRODUCTION),
        }
    }

    pub fn with_endpoints(endpoints: MergeEndpoints) -> Self {
        Self {
            endpoints: Arc::new(endpoints),
        }
    }
}

#[async_trait]
impl IntegrationsProvider for MergeProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Merge
    }

    fn display_name(&self) -> &'static str {
        "Merge"
    }

    fn is_bundled(&self) -> bool {
        // Merge needs zero bundled artifacts — pure OAuth + HTTP from the engine.
        true
    }

    async fn status(&self) -> ProviderStatus {
        match auth::load_auth() {
            Ok(a) => {
                if a.access_token.is_none() {
                    ProviderStatus::NeedsAuth
                } else {
                    // We don't fetch /userinfo here to keep status cheap — the
                    // dashboard will populate email via list_connections / a
                    // separate /me call if Merge exposes one.
                    ProviderStatus::Ok {
                        email: None,
                        org_name: None,
                    }
                }
            }
            Err(AuthError::Keychain(msg)) => ProviderStatus::Error { message: msg },
            Err(e) => ProviderStatus::Error {
                message: e.to_string(),
            },
        }
    }

    async fn start_login(&self) -> ProviderResult<LoginFlow> {
        // 1. Reserve a free local port for the OAuth callback.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| ProviderError::local(format!("bind callback listener: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| ProviderError::local(format!("local_addr: {e}")))?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{port}/callback");

        // 2. Reuse or register a client_id.
        let mut persisted = auth::load_auth().map_err(map_auth_err)?;
        let client_id = if let Some(existing) = persisted.client_id.clone() {
            existing
        } else {
            let new_id = auth::register_client(&self.endpoints, &redirect_uri)
                .await
                .map_err(map_auth_err)?;
            persisted.client_id = Some(new_id.clone());
            persisted.redirect_uri = Some(redirect_uri.clone());
            auth::save_auth(&persisted).map_err(map_auth_err)?;
            new_id
        };

        // 3. Build PKCE + state.
        let verifier = auth::generate_pkce_verifier();
        let challenge = auth::derive_pkce_challenge(&verifier);
        let state = auth::generate_state();

        // 4. Spawn the listener (oneshot — closes after first callback).
        let (code_tx, code_rx) = tokio::sync::oneshot::channel::<String>();
        let expected_state = state.clone();
        tokio::spawn(async move {
            if let Err(e) = serve_callback(listener, expected_state, code_tx).await {
                tracing::warn!(error = ?e, "merge oauth callback listener exited with error");
            }
        });

        // 5. Record the pending flow so complete_login can find it.
        PENDING_LOGINS.lock().unwrap().insert(
            state.clone(),
            PendingLoginState {
                pkce_verifier: verifier,
                redirect_uri: redirect_uri.clone(),
                client_id: client_id.clone(),
                code_recv: Arc::new(tokio::sync::Mutex::new(Some(code_rx))),
            },
        );

        // 6. Hand the user the authorize URL.
        let auth_url =
            auth::authorization_url(&self.endpoints, &client_id, &redirect_uri, &challenge, &state);
        Ok(LoginFlow {
            login_url: auth_url,
            completion_key: state,
        })
    }

    async fn complete_login(&self, completion_key: &str) -> ProviderResult<()> {
        // Pull the pending flow from the registry. `remove` once — if the caller
        // double-invokes we want the second call to fail loudly rather than
        // silently re-exchange the same code (which the server would reject).
        let pending = PENDING_LOGINS
            .lock()
            .unwrap()
            .remove(completion_key)
            .ok_or_else(|| {
                ProviderError::local(
                    "no pending Merge login found — start_login must be called first",
                )
            })?;

        // Wait for the local callback listener to capture the code. Bounded so
        // a forgotten browser tab doesn't pin the future forever.
        let code = {
            let mut guard = pending.code_recv.lock().await;
            let recv = guard
                .take()
                .ok_or_else(|| ProviderError::local("callback receiver already consumed"))?;
            tokio::time::timeout(std::time::Duration::from_secs(300), recv)
                .await
                .map_err(|_| {
                    ProviderError::upstream(
                        "Merge OAuth callback timed out after 5 minutes — try again",
                    )
                })?
                .map_err(|e| ProviderError::local(format!("callback channel closed: {e}")))?
        };

        let persisted = auth::exchange_code(
            &self.endpoints,
            &pending.client_id,
            &pending.redirect_uri,
            &code,
            &pending.pkce_verifier,
        )
        .await
        .map_err(map_auth_err)?;
        auth::save_auth(&persisted).map_err(map_auth_err)?;
        Ok(())
    }

    async fn logout(&self) -> ProviderResult<()> {
        auth::clear_auth().map_err(map_auth_err)?;
        PENDING_LOGINS.lock().unwrap().clear();
        Ok(())
    }

    async fn list_apps(&self) -> ProviderResult<Vec<AppEntry>> {
        let token = auth::valid_access_token(&self.endpoints)
            .await
            .map_err(map_auth_err)?;
        let tools = mcp::list_tools(&self.endpoints, &token)
            .await
            .map_err(map_mcp_err)?;

        // Each connector contributes multiple tools; collapse to one AppEntry
        // per connector. For each connector, prefer our branded catalog entry
        // (real name, real logo, real description); fall back to the slug-derived
        // shape when the catalog has no match — Merge can introduce new
        // connectors faster than we can curate them.
        let mut by_connector: HashMap<String, AppEntry> = HashMap::new();
        for tool in tools {
            let Some(slug) = tool.connector else { continue };
            by_connector
                .entry(slug.clone())
                .or_insert_with(|| entry_from_catalog_or_fallback(&slug, &tool.description));
        }
        let mut apps: Vec<AppEntry> = by_connector.into_values().collect();
        apps.sort_by(|a, b| a.display_name.cmp(&b.display_name));
        Ok(apps)
    }

    async fn list_connections(&self) -> ProviderResult<Vec<Connection>> {
        let token = auth::valid_access_token(&self.endpoints)
            .await
            .map_err(map_auth_err)?;

        // Merge exposes connected accounts through the MCP server, but the
        // exact tool name isn't pinned in their public docs. Strategy: list
        // every tool and look for one matching a known introspection pattern.
        // If we find one, call it and convert the result into Connection
        // shapes. If we don't, return an empty list (legitimate state: user
        // is signed in to Merge but hasn't linked any apps yet) and log so
        // we can debug from telemetry without bombarding the user with a
        // toast on a graceful-empty state.
        let tools = mcp::list_tools(&self.endpoints, &token)
            .await
            .map_err(map_mcp_err)?;

        let introspection_tool = tools.iter().map(|t| t.name.as_str()).find(|n| {
            let lower = n.to_ascii_lowercase();
            // Patterns Merge's docs hint at across blog posts + IDE examples.
            // Cheap O(few tools) scan — `tools/list` only returns the
            // connectors enabled for this user, so cardinality is bounded.
            lower == "list_connected_accounts"
                || lower == "connections_list"
                || lower == "list_connections"
                || lower == "get_connections"
                || lower.ends_with("_list_accounts")
        });

        let Some(tool_name) = introspection_tool else {
            tracing::debug!(
                "merge MCP exposes no connection-introspection tool; returning empty list"
            );
            return Ok(Vec::new());
        };

        let raw = mcp::call_tool(
            &self.endpoints,
            &token,
            tool_name,
            serde_json::json!({}),
        )
        .await
        .map_err(map_mcp_err)?;

        Ok(parse_connections(&raw))
    }

    async fn connect_app(&self, slug: &str) -> ProviderResult<AppConnectionFlow> {
        if slug.is_empty() {
            return Err(ProviderError::unknown_app(slug));
        }
        let token = auth::valid_access_token(&self.endpoints)
            .await
            .map_err(map_auth_err)?;
        // Merge's documented flow: invoking a tool on an unlinked connector
        // returns a Magic Link in the tool result. We trigger that by calling
        // a benign "describe" / "ping" tool on the connector.
        let result = mcp::call_tool(
            &self.endpoints,
            &token,
            &format!("{slug}_connect"),
            serde_json::json!({}),
        )
        .await
        .map_err(map_mcp_err)?;

        let url = result
            .pointer("/magic_link")
            .or_else(|| result.pointer("/redirect_url"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                ProviderError::local(format!(
                    "Merge response missing magic_link for connector '{slug}'"
                ))
            })?
            .to_string();

        Ok(AppConnectionFlow {
            redirect_url: url,
            handle: None,
        })
    }

    async fn disconnect_app(&self, slug: &str) -> ProviderResult<()> {
        let token = auth::valid_access_token(&self.endpoints)
            .await
            .map_err(map_auth_err)?;
        mcp::call_tool(
            &self.endpoints,
            &token,
            &format!("{slug}_disconnect"),
            serde_json::json!({}),
        )
        .await
        .map_err(map_mcp_err)?;
        Ok(())
    }

    async fn mcp_endpoint(&self) -> ProviderResult<McpEndpoint> {
        let token = auth::valid_access_token(&self.endpoints)
            .await
            .map_err(map_auth_err)?;
        Ok(McpEndpoint {
            url: self.endpoints.mcp.to_string(),
            bearer_token: Some(token),
            extra_headers: Vec::new(),
        })
    }

    fn integrations_guidance(&self) -> &'static str {
        crate::guidance::MERGE_GUIDANCE
    }
}

/// Tiny embedded HTTP server that captures the OAuth callback. Reads one
/// request, validates the `state` matches the expected value, sends the auth
/// `code` through the oneshot channel, returns a friendly HTML page, then exits.
async fn serve_callback(
    listener: tokio::net::TcpListener,
    expected_state: String,
    code_tx: tokio::sync::oneshot::Sender<String>,
) -> std::io::Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (mut socket, _) = listener.accept().await?;
    let mut buf = vec![0u8; 4096];
    let n = socket.read(&mut buf).await?;
    let req = String::from_utf8_lossy(&buf[..n]).to_string();

    // First line: `GET /callback?code=...&state=... HTTP/1.1`
    let path = req
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/");
    let parsed = url::Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    let mut got_code: Option<String> = None;
    let mut got_state: Option<String> = None;
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "code" => got_code = Some(v.to_string()),
            "state" => got_state = Some(v.to_string()),
            _ => {}
        }
    }

    let (status, body) = if got_state.as_deref() != Some(expected_state.as_str()) {
        (
            "400 Bad Request",
            "<h1>Login failed</h1><p>State mismatch. Try again from Houston.</p>",
        )
    } else if let Some(code) = got_code {
        let _ = code_tx.send(code);
        (
            "200 OK",
            "<h1>You're signed in!</h1><p>You can close this window and return to Houston.</p>",
        )
    } else {
        (
            "400 Bad Request",
            "<h1>Login failed</h1><p>No authorization code in callback URL.</p>",
        )
    };

    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
        len = body.len()
    );
    socket.write_all(resp.as_bytes()).await?;
    Ok(())
}

fn map_auth_err(e: AuthError) -> ProviderError {
    match e {
        AuthError::Keychain(msg) => ProviderError::local(format!("keychain: {msg}")),
        AuthError::Http(msg) => ProviderError::upstream(msg),
        AuthError::TokenExchange(msg) => {
            // Bucket 401/403-bearing messages into the precise variant.
            if msg.contains("403") {
                ProviderError::forbidden(msg)
            } else if msg.contains("401") || msg.contains("invalid_grant") {
                ProviderError::unauthenticated(msg)
            } else {
                ProviderError::upstream(msg)
            }
        }
        AuthError::NoRefreshToken | AuthError::NoAccessToken => {
            ProviderError::unauthenticated(e.to_string())
        }
        AuthError::Unregistered => ProviderError::not_installed(e.to_string()),
        AuthError::Internal(msg) => ProviderError::internal(msg),
    }
}

fn map_mcp_err(e: mcp::McpError) -> ProviderError {
    match e {
        mcp::McpError::Http(msg) => ProviderError::upstream(msg),
        mcp::McpError::Unauthorized => {
            ProviderError::unauthenticated("Merge MCP rejected the bearer token")
        }
        mcp::McpError::Forbidden(msg) => ProviderError::forbidden(msg),
        mcp::McpError::ParseJson(msg) => ProviderError::internal(msg),
    }
}

/// Title-case a slug for the unknown-connector fallback. Used only when the
/// static catalog has no entry — keeps the UI from showing raw `snake_case`.
fn prettify_slug(slug: &str) -> String {
    slug.split(&['-', '_'][..])
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Build an `AppEntry` from a catalog hit, or fall back to slug-derived
/// defaults when we have no curated metadata.
fn entry_from_catalog_or_fallback(slug: &str, mcp_description: &str) -> AppEntry {
    if let Some(meta) = crate::catalog::lookup(slug) {
        AppEntry {
            slug: slug.to_string(),
            display_name: meta.display_name.to_string(),
            description: meta.description.to_string(),
            logo_url: meta.logo_url.to_string(),
            connected: false,
        }
    } else {
        AppEntry {
            slug: slug.to_string(),
            display_name: prettify_slug(slug),
            description: if mcp_description.is_empty() {
                "Connected service".to_string()
            } else {
                mcp_description.to_string()
            },
            logo_url: format!("https://www.google.com/s2/favicons?domain={slug}.com&sz=128"),
            connected: false,
        }
    }
}

/// Convert a raw MCP introspection response into a list of `Connection`.
///
/// Defensive against schema variation — Merge's docs don't pin the exact
/// shape, so we accept any of the following patterns and tolerate missing
/// fields rather than throwing:
///
/// ```jsonc
/// {"content": [{"text": "...json string..."}]}            // MCP wrap
/// {"connections": [...]}                                   // direct array
/// [{"slug": "...", ...}]                                   // bare array
/// ```
fn parse_connections(raw: &serde_json::Value) -> Vec<Connection> {
    // Unwrap the common MCP `{result: {content: [{text: "..."}]}}` envelope
    // by walking known paths, then fall back to scanning the value itself.
    let candidates: Vec<&serde_json::Value> = [
        raw.pointer("/content/0/text"),
        raw.pointer("/connections"),
        Some(raw),
    ]
    .into_iter()
    .flatten()
    .collect();

    for cand in candidates {
        // If it's a string (the MCP text wrapping), try to parse it as JSON.
        let parsed_owned;
        let value: &serde_json::Value = if let Some(s) = cand.as_str() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
                parsed_owned = v;
                &parsed_owned
            } else {
                continue;
            }
        } else {
            cand
        };

        // Now look for an array we can map.
        let arr = value
            .pointer("/connections")
            .and_then(|v| v.as_array())
            .or_else(|| value.as_array())
            .cloned();

        let Some(arr) = arr else { continue };
        return arr.iter().filter_map(connection_from_value).collect();
    }

    Vec::new()
}

fn connection_from_value(v: &serde_json::Value) -> Option<Connection> {
    let slug = v
        .get("slug")
        .or_else(|| v.get("connector"))
        .or_else(|| v.get("toolkit"))
        .and_then(|s| s.as_str())?
        .to_string();
    let catalog_meta = crate::catalog::lookup(&slug);
    let display_name = v
        .get("display_name")
        .or_else(|| v.get("name"))
        .and_then(|s| s.as_str())
        .map(String::from)
        .unwrap_or_else(|| {
            catalog_meta
                .map(|m| m.display_name.to_string())
                .unwrap_or_else(|| prettify_slug(&slug))
        });
    let description = catalog_meta
        .map(|m| m.description.to_string())
        .unwrap_or_else(|| "Connected service".to_string());
    let logo_url = catalog_meta
        .map(|m| m.logo_url.to_string())
        .unwrap_or_else(|| format!("https://www.google.com/s2/favicons?domain={slug}.com&sz=128"));

    Some(Connection {
        slug,
        display_name,
        description,
        logo_url,
        email: v
            .get("email")
            .or_else(|| v.pointer("/account/email"))
            .and_then(|s| s.as_str())
            .map(String::from),
        connected_at: v
            .get("connected_at")
            .or_else(|| v.get("created_at"))
            .and_then(|s| s.as_str())
            .map(String::from),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prettify_slug_handles_underscores_and_dashes() {
        assert_eq!(prettify_slug("gmail"), "Gmail");
        assert_eq!(prettify_slug("google_calendar"), "Google Calendar");
        assert_eq!(prettify_slug("ms-teams"), "Ms Teams");
        assert_eq!(prettify_slug(""), "");
    }

    #[test]
    fn provider_id_is_merge() {
        let p = MergeProvider::new();
        assert_eq!(p.id(), ProviderId::Merge);
        assert_eq!(p.display_name(), "Merge");
        assert!(p.is_bundled(), "Merge has no bundled binary to ship");
    }

    #[test]
    fn entry_uses_catalog_for_known_slug() {
        let entry = entry_from_catalog_or_fallback("gmail", "send mail");
        assert_eq!(entry.display_name, "Gmail");
        assert!(entry.logo_url.contains("gstatic.com"));
        // Catalog description wins over the MCP-supplied tool description.
        assert_eq!(entry.description, "Send and read emails");
    }

    #[test]
    fn entry_falls_back_to_slug_for_unknown() {
        let entry = entry_from_catalog_or_fallback("totally_made_up", "");
        assert_eq!(entry.display_name, "Totally Made Up");
        assert_eq!(entry.description, "Connected service");
        assert!(entry.logo_url.contains("s2/favicons"));
    }

    #[test]
    fn parse_connections_accepts_bare_array() {
        let raw = serde_json::json!([
            { "slug": "gmail", "email": "j@example.com", "connected_at": "2026-05-24T20:00:00Z" },
            { "slug": "slack" }
        ]);
        let conns = parse_connections(&raw);
        assert_eq!(conns.len(), 2);
        assert_eq!(conns[0].slug, "gmail");
        assert_eq!(conns[0].display_name, "Gmail");
        assert_eq!(conns[0].email.as_deref(), Some("j@example.com"));
        assert_eq!(conns[1].slug, "slack");
        assert_eq!(conns[1].display_name, "Slack");
    }

    #[test]
    fn parse_connections_accepts_connections_wrapper() {
        let raw = serde_json::json!({
            "connections": [
                { "connector": "linear" }
            ]
        });
        let conns = parse_connections(&raw);
        assert_eq!(conns.len(), 1);
        assert_eq!(conns[0].slug, "linear");
    }

    #[test]
    fn parse_connections_accepts_mcp_content_wrapper() {
        // MCP tool responses commonly wrap the payload as a JSON string inside
        // result.content[0].text — handle that without forcing the caller to
        // pre-process.
        let inner = serde_json::json!({
            "connections": [{ "slug": "github" }]
        })
        .to_string();
        let raw = serde_json::json!({
            "content": [{ "type": "text", "text": inner }]
        });
        let conns = parse_connections(&raw);
        assert_eq!(conns.len(), 1);
        assert_eq!(conns[0].slug, "github");
        assert_eq!(conns[0].display_name, "GitHub");
    }

    #[test]
    fn parse_connections_returns_empty_on_unknown_shape() {
        let raw = serde_json::json!({"unexpected": "shape"});
        assert!(parse_connections(&raw).is_empty());
    }
}
