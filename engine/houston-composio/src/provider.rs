//! [`IntegrationsProvider`] implementation for Composio.
//!
//! Thin adapter from Composio's existing CLI-driven internals
//! (`cli`, `install`, `apps`, `mcp`) to the shared trait. The legacy free-function
//! `commands` API is preserved so existing callers (Tauri adapter, current REST
//! routes) keep working — this just adds a trait surface on top.
//!
//! Mapping from Composio's native shapes:
//! - `ComposioStatus::{NotInstalled,NeedsAuth,Ok,Error}` →
//!   `ProviderStatus::{NotInstalled,NeedsAuth,Ok,Error}` (1:1, names align).
//! - `StartLoginResponse { login_url, cli_key }` → `LoginFlow { login_url, completion_key }`
//!   where `completion_key = cli_key`. `complete_login` reverses the field name.
//! - `StartLinkResponse` → `AppConnectionFlow` (drops `toolkit` field — caller
//!   already knows the slug they asked for).
//! - `ComposioConnection` → `Connection` (1:1 rename).
//! - `ComposioAppEntry` → `AppEntry` (adds `connected: bool` computed from the
//!   user's current connection list).

use async_trait::async_trait;
use houston_integrations::{
    AppConnectionFlow, AppEntry, Connection, IntegrationsProvider, LoginFlow, McpEndpoint,
    ProviderError, ProviderId, ProviderResult, ProviderStatus,
};
use std::collections::HashSet;

use crate::cli;
use crate::install;
use crate::mcp as composio_mcp;

/// Provider handle. Stateless — every call delegates to the existing CLI/MCP
/// helpers, which manage their own state under `~/.composio/`. Cheap to clone
/// (only an empty struct).
#[derive(Debug, Clone, Default)]
pub struct ComposioProvider;

impl ComposioProvider {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl IntegrationsProvider for ComposioProvider {
    fn id(&self) -> ProviderId {
        ProviderId::Composio
    }

    fn display_name(&self) -> &'static str {
        "Composio"
    }

    fn is_bundled(&self) -> bool {
        // Composio ships inside Houston.app via Resources/bin/composio-<arch>/
        // (see knowledge-base/cli-bundling.md). When the bundle resolver finds
        // it there, the runtime CLI install is skipped entirely. Marking the
        // provider as bundled tells the UI not to show an "Install" affordance.
        houston_cli_bundle::bundled_composio_binary().is_some()
    }

    async fn status(&self) -> ProviderStatus {
        match cli::status().await {
            cli::ComposioStatus::NotInstalled => ProviderStatus::NotInstalled,
            cli::ComposioStatus::NeedsAuth => ProviderStatus::NeedsAuth,
            cli::ComposioStatus::Ok { email, org_name } => ProviderStatus::Ok { email, org_name },
            cli::ComposioStatus::Error { message } => ProviderStatus::Error { message },
        }
    }

    async fn start_login(&self) -> ProviderResult<LoginFlow> {
        if !install::is_installed() {
            return Err(ProviderError::not_installed(
                "Composio CLI not installed. Houston should bundle it; if you're in dev mode, run the install flow.",
            ));
        }
        cli::start_login()
            .await
            .map(|r| LoginFlow {
                login_url: r.login_url,
                completion_key: r.cli_key,
            })
            .map_err(classify_login_err)
    }

    async fn complete_login(&self, completion_key: &str) -> ProviderResult<()> {
        cli::complete_login(completion_key)
            .await
            .map_err(classify_login_err)
    }

    async fn logout(&self) -> ProviderResult<()> {
        cli::logout().await.map_err(ProviderError::local)
    }

    async fn list_apps(&self) -> ProviderResult<Vec<AppEntry>> {
        let catalog = crate::apps::list_all_apps().await;
        let connected: HashSet<String> = crate::toolkits::normalize_toolkit_slugs(
            cli::list_connected_toolkits().await,
        )
        .into_iter()
        .collect();
        Ok(catalog
            .into_iter()
            .map(|entry| AppEntry {
                connected: connected.contains(&entry.toolkit),
                slug: entry.toolkit,
                display_name: entry.name,
                description: entry.description,
                logo_url: entry.logo_url,
            })
            .collect())
    }

    async fn list_connections(&self) -> ProviderResult<Vec<Connection>> {
        match composio_mcp::list_active_connections().await {
            composio_mcp::ComposioResult::Ok { connections } => Ok(connections
                .into_iter()
                .map(|c| Connection {
                    slug: c.toolkit,
                    display_name: c.display_name,
                    description: c.description,
                    logo_url: c.logo_url,
                    email: c.email,
                    connected_at: c.connected_at,
                })
                .collect()),
            composio_mcp::ComposioResult::NotConfigured => Err(ProviderError::not_installed(
                "Composio MCP URL not configured in ~/.claude.json",
            )),
            composio_mcp::ComposioResult::NeedsAuth => Err(ProviderError::unauthenticated(
                "Composio OAuth token missing or expired",
            )),
            composio_mcp::ComposioResult::Error { message } => {
                Err(classify_mcp_err(&message))
            }
        }
    }

    async fn connect_app(&self, slug: &str) -> ProviderResult<AppConnectionFlow> {
        if slug.is_empty() {
            return Err(ProviderError::unknown_app(slug));
        }
        cli::start_link(slug)
            .await
            .map(|r| AppConnectionFlow {
                redirect_url: r.redirect_url,
                handle: Some(r.connected_account_id),
            })
            .map_err(|e| {
                // CLI surfaces "already connected" via err message — treat as Local
                // so the UI surfaces the actionable text verbatim.
                if e.contains("already connected") {
                    ProviderError::local(e)
                } else {
                    classify_login_err(e)
                }
            })
    }

    async fn disconnect_app(&self, _slug: &str) -> ProviderResult<()> {
        // The composio CLI does not currently expose a `disconnect` subcommand for
        // consumer-namespace connections — users disconnect through the Composio
        // dashboard. We return an error rather than silently succeeding so the UI
        // can render a "Manage on composio.dev" link instead of a fake success toast.
        Err(ProviderError::local(
            "Disconnecting apps is not supported from Houston. Manage at composio.dev.",
        ))
    }

    fn integrations_guidance(&self) -> &'static str {
        crate::guidance::COMPOSIO_GUIDANCE
    }

    async fn mcp_endpoint(&self) -> ProviderResult<McpEndpoint> {
        let url = composio_mcp::read_composio_url()
            .ok_or_else(|| ProviderError::not_installed(
                "Composio MCP URL not configured in ~/.claude.json",
            ))?;
        let token = composio_mcp::get_valid_token().await.ok_or_else(|| {
            ProviderError::unauthenticated("Composio OAuth token missing or expired")
        })?;
        Ok(McpEndpoint {
            url,
            bearer_token: Some(token),
            extra_headers: Vec::new(),
        })
    }
}

/// Best-effort classification of CLI subprocess errors. The CLI returns
/// String errors with mixed content; we look for known patterns to bucket
/// them into the shared taxonomy.
fn classify_login_err(e: String) -> ProviderError {
    let lower = e.to_lowercase();
    if lower.contains("403") || lower.contains("forbidden") {
        ProviderError::forbidden(e)
    } else if lower.contains("not logged") || lower.contains("unauthenticated") {
        ProviderError::unauthenticated(e)
    } else if lower.contains("timed out") || lower.contains("connection") {
        ProviderError::upstream(e)
    } else if lower.contains("not installed") || lower.contains("no such file") {
        ProviderError::not_installed(e)
    } else {
        ProviderError::local(e)
    }
}

/// Classification for errors that originate from the Composio MCP server
/// (HTTP-level failures, not CLI failures). Slightly different signals.
fn classify_mcp_err(message: &str) -> ProviderError {
    let lower = message.to_lowercase();
    if lower.contains("403") || lower.contains("forbidden") {
        ProviderError::forbidden(message.to_string())
    } else if lower.contains("401") || lower.contains("unauthorized") {
        ProviderError::unauthenticated(message.to_string())
    } else if lower.contains("could not reach") || lower.contains("connection") {
        ProviderError::upstream(message.to_string())
    } else {
        ProviderError::local(message.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_login_err_buckets() {
        assert!(matches!(
            classify_login_err("HTTP 403 Forbidden".into()),
            ProviderError::Forbidden { .. }
        ));
        assert!(matches!(
            classify_login_err("user not logged in".into()),
            ProviderError::Unauthenticated { .. }
        ));
        assert!(matches!(
            classify_login_err("composio login --no-wait timed out".into()),
            ProviderError::Upstream { .. }
        ));
        assert!(matches!(
            classify_login_err("composio binary not installed".into()),
            ProviderError::NotInstalled { .. }
        ));
        assert!(matches!(
            classify_login_err("unexpected stuff".into()),
            ProviderError::Local { .. }
        ));
    }

    #[test]
    fn provider_id_is_composio() {
        let p = ComposioProvider::new();
        assert_eq!(p.id(), ProviderId::Composio);
        assert_eq!(p.display_name(), "Composio");
    }
}
