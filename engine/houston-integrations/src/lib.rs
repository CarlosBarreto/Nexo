//! houston-integrations — provider-agnostic interface for the integrations layer.
//!
//! Houston historically hard-coded Composio everywhere. After the May 2026 Composio
//! incident we want the option to swap providers (Composio ↔ Merge ↔ future) without
//! agents or the UI noticing. This crate defines the contract.
//!
//! Implementations live in their own crates:
//! - `houston-composio::ComposioProvider`
//! - `houston-merge::MergeProvider`
//!
//! Both implement [`IntegrationsProvider`]. The engine picks one based on the
//! user's preference and routes every integration call through the trait — agents
//! see identical tool surfaces, the UI shows identical status / connection cards.
//!
//! Frontend-agnostic: no Tauri, no React, no platform-specific code in here. Each
//! implementation owns its own platform details (keychain, subprocess, OAuth flow).

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub mod error;

pub use error::{ProviderError, ProviderResult};

/// Stable identifier for an integrations provider. Used in preferences, routes,
/// telemetry. New providers add a variant — old preferences keep working.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Composio,
    Merge,
}

impl ProviderId {
    pub fn as_str(self) -> &'static str {
        match self {
            ProviderId::Composio => "composio",
            ProviderId::Merge => "merge",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "composio" => Some(ProviderId::Composio),
            "merge" => Some(ProviderId::Merge),
            _ => None,
        }
    }
}

/// What a provider is currently capable of, from Houston's perspective.
///
/// This is the unified shape the UI renders — every provider collapses its own
/// internal states (CLI installed?, OAuth token valid?, server reachable?) into
/// one of these variants.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ProviderStatus {
    /// The provider isn't usable until something is installed/configured.
    /// E.g. Composio CLI not yet downloaded. UI offers a one-click install.
    NotInstalled,

    /// Installed/reachable but the user has not signed in. UI shows
    /// the sign-in card with the provider's display name.
    NeedsAuth,

    /// Fully signed in and ready to use. Optional account metadata.
    Ok {
        email: Option<String>,
        org_name: Option<String>,
    },

    /// Something is wrong (network, server error, etc.). UI surfaces the message
    /// + a Report-bug affordance per the beta-stage policy.
    Error { message: String },
}

/// Returned by [`IntegrationsProvider::start_login`]. The frontend opens
/// `login_url` in the user's browser. Once the user has approved, the frontend
/// calls [`IntegrationsProvider::complete_login`] with `completion_key`.
///
/// Some providers (Composio) use a custom polling key; others (Merge) embed a
/// state token in the OAuth callback. Houston treats it as an opaque string —
/// the provider knows what to do with it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginFlow {
    pub login_url: String,
    pub completion_key: String,
}

/// One app/toolkit/connector available through this provider (Gmail, Slack, …).
///
/// All providers normalize their catalogs to this shape. UI renders one grid
/// regardless of which provider is active.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppEntry {
    /// Provider-native slug. Composio: "gmail". Merge: "gmail".
    /// Frontend uses this verbatim when calling `connect_app`.
    pub slug: String,
    pub display_name: String,
    pub description: String,
    pub logo_url: String,
    /// Whether the user has currently connected this app.
    pub connected: bool,
}

/// A live connection the user has authorized for a specific app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub slug: String,
    pub display_name: String,
    pub description: String,
    pub logo_url: String,
    pub email: Option<String>,
    pub connected_at: Option<String>,
}

/// Returned by [`IntegrationsProvider::connect_app`]. Frontend opens
/// `redirect_url` in a browser/webview; the provider's backend completes the
/// app-specific OAuth flow on its own and the agent can use the app shortly after.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConnectionFlow {
    pub redirect_url: String,
    /// Optional handle for follow-up polling. Composio returns a
    /// `connected_account_id`; Merge returns nothing (the magic link is
    /// self-completing).
    pub handle: Option<String>,
}

/// How an agent reaches this provider's MCP server. The engine forwards these
/// fields to the spawned `claude`/`codex`/etc. subprocess via env vars or
/// `~/.claude.json` so the agent's MCP client can connect.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpEndpoint {
    /// HTTP(S) URL — both providers we currently support use HTTP transport,
    /// not stdio.
    pub url: String,
    /// Bearer token if the endpoint requires auth (always for Composio + Merge).
    pub bearer_token: Option<String>,
    /// Extra HTTP headers (rarely needed; placeholder for future providers).
    #[serde(default)]
    pub extra_headers: Vec<(String, String)>,
}

/// The contract every integrations provider must implement.
///
/// Async, `Send + Sync`, object-safe — the engine holds it as
/// `Arc<dyn IntegrationsProvider>`. Implementations must be cheap to clone
/// (the engine may clone references freely).
///
/// Error handling: per the no-silent-failures policy, every fallible method
/// returns `Result<_, ProviderError>`. The provider classifies its native
/// failures into the shared taxonomy in [`error::ProviderError`] so the UI
/// renders consistent error cards regardless of which provider is active.
#[async_trait]
pub trait IntegrationsProvider: Send + Sync {
    /// Stable identifier (e.g. "composio", "merge"). Matches [`ProviderId`].
    fn id(&self) -> ProviderId;

    /// Human-readable name for the UI ("Composio", "Merge Agent Handler", …).
    fn display_name(&self) -> &'static str;

    /// Current state of the provider (installed, signed-in, etc.).
    /// Should be cheap — the UI polls this. Heavy work goes in `list_*`.
    async fn status(&self) -> ProviderStatus;

    /// Begin the provider-level login flow (signing into Composio/Merge as a user,
    /// NOT linking an individual app like Gmail). Returns a URL to open.
    async fn start_login(&self) -> ProviderResult<LoginFlow>;

    /// Finish the provider-level login flow with the completion key from
    /// [`LoginFlow::completion_key`]. After this, [`status`](Self::status)
    /// should return `ProviderStatus::Ok`.
    async fn complete_login(&self, completion_key: &str) -> ProviderResult<()>;

    /// Sign out: clear all stored credentials. After this, `status` should
    /// return `ProviderStatus::NeedsAuth` (or `NotInstalled`).
    async fn logout(&self) -> ProviderResult<()>;

    /// Full catalog of apps available through this provider. Used by the UI's
    /// "Browse apps" grid. Should be cached internally by the implementation —
    /// the UI may call this frequently.
    async fn list_apps(&self) -> ProviderResult<Vec<AppEntry>>;

    /// Apps the user has actively connected. Used by the dashboard.
    async fn list_connections(&self) -> ProviderResult<Vec<Connection>>;

    /// Begin connecting a specific app. Returns a URL the user opens in their
    /// browser to grant access to the third-party app (Gmail, Slack, etc.).
    async fn connect_app(&self, slug: &str) -> ProviderResult<AppConnectionFlow>;

    /// Disconnect a connected app. After this, the agent can no longer call
    /// tools from that app.
    async fn disconnect_app(&self, slug: &str) -> ProviderResult<()>;

    /// How agents reach this provider's MCP server. The engine plumbs this
    /// through to spawned agent subprocesses.
    async fn mcp_endpoint(&self) -> ProviderResult<McpEndpoint>;

    /// Returns true if this provider is bundled into the Houston `.app`/`.msi`
    /// (i.e. needs no external install). Composio bundles a CLI; Merge does not.
    /// Used by the UI to skip the "Install" step for self-contained providers.
    fn is_bundled(&self) -> bool {
        false
    }

    /// Provider-specific instructions appended to the agent's system prompt
    /// so the model knows HOW to discover + invoke tools through THIS provider.
    /// Composio's guidance talks about `composio search` / `composio execute`;
    /// Merge's talks about MCP tool names + magic links. Without this hook the
    /// agent would have to guess the calling convention.
    ///
    /// Default is empty — providers that don't need agent-side guidance
    /// (or that haven't published it yet) can omit. The engine concatenates
    /// the non-empty result with the standard `\n\n---\n\n` separator.
    fn integrations_guidance(&self) -> &'static str {
        ""
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_id_roundtrips() {
        assert_eq!(ProviderId::from_str("composio"), Some(ProviderId::Composio));
        assert_eq!(ProviderId::from_str("MERGE"), Some(ProviderId::Merge));
        assert_eq!(ProviderId::from_str("unknown"), None);
        assert_eq!(ProviderId::Composio.as_str(), "composio");
        assert_eq!(ProviderId::Merge.as_str(), "merge");
    }

    #[test]
    fn provider_status_serializes_externally_tagged() {
        let s = ProviderStatus::Ok {
            email: Some("test@example.com".into()),
            org_name: None,
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"status\":\"ok\""));
        assert!(json.contains("\"email\":\"test@example.com\""));
    }

    #[test]
    fn provider_status_needs_auth_no_payload() {
        let json = serde_json::to_string(&ProviderStatus::NeedsAuth).unwrap();
        assert_eq!(json, "{\"status\":\"needs_auth\"}");
    }
}
