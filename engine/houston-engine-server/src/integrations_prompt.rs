//! Per-session system prompt composition.
//!
//! The Houston app passes a base identity prompt at engine startup via
//! `HOUSTON_APP_SYSTEM_PROMPT`. Provider-specific operational guidance
//! (how to discover and invoke tools through Composio vs Merge) is appended
//! HERE so the agent sees the right instructions for whichever provider the
//! user has currently selected, without restarting the engine.
//!
//! The active-provider preference is read on every call so a runtime switch
//! via the picker takes effect on the very next session start — no caching,
//! no boot-time snapshot.

use crate::state::ServerState;
use houston_composio::ComposioProvider;
use houston_engine_core::preferences;
use houston_integrations::{IntegrationsProvider, ProviderId};
use houston_merge::MergeProvider;

/// Preferences key for the active integrations provider. Mirrors the constant
/// in `routes/integrations.rs` so both surfaces read the same value.
const ACTIVE_PROVIDER_PREF: &str = "integrations.active_provider";

/// Resolve the active provider's guidance text. Cheap to call — implementations
/// return `&'static str`. Returns `""` if the active provider has no guidance
/// or the preference lookup fails (the agent works without it, just without
/// per-provider operational instructions).
async fn active_provider_guidance(state: &ServerState) -> &'static str {
    let id = match preferences::get(&state.engine.db, ACTIVE_PROVIDER_PREF).await {
        Ok(Some(raw)) => ProviderId::from_str(raw.trim()).unwrap_or(ProviderId::Composio),
        _ => ProviderId::Composio,
    };
    match id {
        ProviderId::Composio => ComposioProvider::new().integrations_guidance(),
        ProviderId::Merge => MergeProvider::new().integrations_guidance(),
    }
}

/// Compose the full app-layer system prompt for THIS session start.
///
/// `<base prompt from the Houston app> + <active provider's guidance>`
///
/// The provider guidance already begins with `\n\n---\n\n` so this is a
/// simple concatenation — no separator decision needed here.
pub async fn compose_app_system_prompt(state: &ServerState) -> String {
    let mut out = state.engine.app_system_prompt.clone();
    out.push_str(active_provider_guidance(state).await);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ServerConfig;

    fn test_config() -> ServerConfig {
        let home = tempfile::TempDir::new().unwrap();
        let docs = tempfile::TempDir::new().unwrap();
        let cfg = ServerConfig {
            bind: "127.0.0.1:0".parse().unwrap(),
            token: "prompt-test".into(),
            home_dir: home.path().to_path_buf(),
            docs_dir: docs.path().to_path_buf(),
            app_system_prompt: "BASE_HOUSTON_PROMPT".into(),
            app_onboarding_prompt: String::new(),
            tunnel_url: "http://test.invalid".into(),
        };
        std::mem::forget(home);
        std::mem::forget(docs);
        cfg
    }

    async fn mem_state() -> ServerState {
        ServerState::new_in_memory(test_config()).await.unwrap()
    }

    #[tokio::test]
    async fn defaults_to_composio_guidance_when_pref_missing() {
        let state = mem_state().await;
        let prompt = compose_app_system_prompt(&state).await;
        assert!(prompt.starts_with("BASE_HOUSTON_PROMPT"));
        assert!(
            prompt.contains("Composio"),
            "expected Composio guidance to be appended by default"
        );
    }

    #[tokio::test]
    async fn appends_merge_guidance_when_user_picked_merge() {
        let state = mem_state().await;
        preferences::set(&state.engine.db, ACTIVE_PROVIDER_PREF, "merge")
            .await
            .unwrap();
        let prompt = compose_app_system_prompt(&state).await;
        assert!(prompt.starts_with("BASE_HOUSTON_PROMPT"));
        assert!(
            prompt.contains("Merge"),
            "expected Merge guidance to be appended"
        );
        // Sanity: the Composio-specific phrasing must not leak.
        assert!(
            !prompt.contains("composio search"),
            "Composio CLI guidance should not appear for Merge users"
        );
    }

    #[tokio::test]
    async fn empty_base_prompt_still_returns_provider_guidance() {
        let mut state = mem_state().await;
        state.engine.app_system_prompt = String::new();
        let prompt = compose_app_system_prompt(&state).await;
        // Provider guidance leads with `\n\n---\n\n`; that's our floor.
        assert!(prompt.starts_with("\n\n---"));
        assert!(prompt.contains("Composio"));
    }
}
