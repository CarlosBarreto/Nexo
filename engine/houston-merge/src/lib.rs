//! houston-merge — Merge Agent Handler integrations provider.
//!
//! Implements [`IntegrationsProvider`] backed by Merge's hosted MCP server
//! at `https://ah-api.merge.dev/mcp`. Unlike Composio, Merge needs no bundled
//! CLI — every Houston user authenticates via standard OAuth 2.0 + PKCE
//! directly against Merge's authorization server, then connects to the hosted
//! MCP endpoint with a Bearer token.
//!
//! Architecture:
//! - `auth.rs`: dynamic client registration + OAuth 2.0 + PKCE; tokens persisted
//!   in the OS keychain (Apple Keychain on macOS, Credential Manager on Windows)
//!   via the `keyring` crate.
//! - `mcp.rs`: MCP JSON-RPC client over HTTP that calls the hosted endpoint.
//! - `provider.rs`: the [`IntegrationsProvider`] implementation that glues
//!   `auth` + `mcp` into Houston's trait surface.
//!
//! No `~/.merge/` directory, no subprocess, no per-platform binary. The entire
//! integration is pure Rust running inside the engine.

pub mod auth;
pub mod catalog;
pub mod guidance;
pub mod mcp;
pub mod provider;

pub use guidance::MERGE_GUIDANCE;
pub use provider::MergeProvider;

/// Default Merge Agent Handler endpoints. Centralised here so tests / overrides
/// (e.g. pointing at a staging server) can clone-and-modify cleanly.
#[derive(Debug, Clone)]
pub struct MergeEndpoints {
    pub authorization: &'static str,
    pub token: &'static str,
    pub registration: &'static str,
    pub mcp: &'static str,
}

impl MergeEndpoints {
    pub const PRODUCTION: Self = Self {
        authorization: "https://ah-api.merge.dev/o/authorize/",
        token: "https://ah-api.merge.dev/o/token/",
        registration: "https://ah-api.merge.dev/o/register/",
        mcp: "https://ah-api.merge.dev/mcp",
    };
}
