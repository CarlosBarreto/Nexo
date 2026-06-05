//! `/v1/integrations/*` — provider-agnostic REST routes.
//!
//! These routes look up the user's currently-selected integrations provider
//! (Composio or Merge) from the preferences DB and forward the call through
//! the shared [`IntegrationsProvider`] trait. The frontend code is identical
//! regardless of which provider is active — that's the whole point of this
//! abstraction.
//!
//! Routes:
//!
//! | Method | Path                              | Trait method               |
//! |--------|-----------------------------------|----------------------------|
//! | GET    | /v1/integrations/active           | (returns active provider)  |
//! | POST   | /v1/integrations/active           | (set active provider)      |
//! | GET    | /v1/integrations/status           | `status`                   |
//! | POST   | /v1/integrations/login            | `start_login`              |
//! | POST   | /v1/integrations/login/complete   | `complete_login`           |
//! | POST   | /v1/integrations/logout           | `logout`                   |
//! | GET    | /v1/integrations/apps             | `list_apps`                |
//! | GET    | /v1/integrations/connections      | `list_connections`         |
//! | POST   | /v1/integrations/connections      | `connect_app`              |
//! | DELETE | /v1/integrations/connections/:slug| `disconnect_app`           |
//! | GET    | /v1/integrations/mcp              | `mcp_endpoint`             |
//!
//! Legacy `/v1/composio/*` routes are kept verbatim for backward compatibility
//! during the migration.

use crate::routes::error::ApiError;
use crate::state::ServerState;
use axum::{
    extract::{Path, State},
    routing::{delete, get, post},
    Json, Router,
};
use houston_composio::ComposioProvider;
use houston_engine_core::preferences;
use houston_integrations::{
    AppConnectionFlow, AppEntry, Connection, IntegrationsProvider, LoginFlow, McpEndpoint,
    ProviderId, ProviderStatus,
};
use houston_merge::MergeProvider;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Preferences DB key for the active integrations provider. Value is the
/// snake-case provider id ("composio" / "merge"). Missing/invalid → Composio.
const ACTIVE_PROVIDER_PREF: &str = "integrations.active_provider";

pub fn router() -> Router<Arc<ServerState>> {
    Router::new()
        .route(
            "/integrations/active",
            get(get_active_provider).post(set_active_provider),
        )
        .route("/integrations/status", get(status))
        .route("/integrations/login", post(start_login))
        .route("/integrations/login/complete", post(complete_login))
        .route("/integrations/logout", post(logout))
        .route("/integrations/apps", get(list_apps))
        .route(
            "/integrations/connections",
            get(list_connections).post(connect_app),
        )
        .route("/integrations/connections/:slug", delete(disconnect_app))
        .route("/integrations/mcp", get(mcp_endpoint))
}

// ----- Active-provider preference ---------------------------------------------------

#[derive(Serialize)]
struct ActiveProviderResponse {
    id: ProviderId,
    display_name: &'static str,
    is_bundled: bool,
}

#[derive(Deserialize)]
struct SetActiveProviderRequest {
    id: ProviderId,
}

/// Resolve the active provider for this user. Reads the persisted preference
/// from the engine DB; falls back to Composio when unset or unparseable so
/// users who upgrade through this change keep their existing behavior.
async fn resolve_active(state: &ServerState) -> ProviderId {
    match preferences::get(&state.engine.db, ACTIVE_PROVIDER_PREF).await {
        Ok(Some(raw)) => ProviderId::from_str(raw.trim()).unwrap_or(ProviderId::Composio),
        Ok(None) => ProviderId::Composio,
        Err(e) => {
            // The DB lookup itself failed — log loudly per the no-silent-failures
            // policy but still return the safe default so the app stays usable.
            tracing::error!(
                preference = ACTIVE_PROVIDER_PREF,
                error = %e,
                "failed to read active integrations provider preference; defaulting to Composio"
            );
            ProviderId::Composio
        }
    }
}

fn provider_for(id: ProviderId) -> Arc<dyn IntegrationsProvider> {
    match id {
        ProviderId::Composio => Arc::new(ComposioProvider::new()),
        ProviderId::Merge => Arc::new(MergeProvider::new()),
    }
}

async fn active_provider(state: &ServerState) -> Arc<dyn IntegrationsProvider> {
    provider_for(resolve_active(state).await)
}

async fn get_active_provider(
    State(state): State<Arc<ServerState>>,
) -> Json<ActiveProviderResponse> {
    let id = resolve_active(&state).await;
    let p = provider_for(id);
    Json(ActiveProviderResponse {
        id,
        display_name: p.display_name(),
        is_bundled: p.is_bundled(),
    })
}

async fn set_active_provider(
    State(state): State<Arc<ServerState>>,
    Json(req): Json<SetActiveProviderRequest>,
) -> Result<Json<ActiveProviderResponse>, ApiError> {
    preferences::set(&state.engine.db, ACTIVE_PROVIDER_PREF, req.id.as_str()).await?;
    let p = provider_for(req.id);
    Ok(Json(ActiveProviderResponse {
        id: req.id,
        display_name: p.display_name(),
        is_bundled: p.is_bundled(),
    }))
}

// ----- Forwarders -------------------------------------------------------------------

async fn status(State(state): State<Arc<ServerState>>) -> Json<ProviderStatus> {
    Json(active_provider(&state).await.status().await)
}

async fn start_login(State(state): State<Arc<ServerState>>) -> Result<Json<LoginFlow>, ApiError> {
    active_provider(&state)
        .await
        .start_login()
        .await
        .map(Json)
        .map_err(provider_err_into_api)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteLogin {
    completion_key: String,
}

async fn complete_login(
    State(state): State<Arc<ServerState>>,
    Json(req): Json<CompleteLogin>,
) -> Result<(), ApiError> {
    active_provider(&state)
        .await
        .complete_login(&req.completion_key)
        .await
        .map_err(provider_err_into_api)
}

async fn logout(State(state): State<Arc<ServerState>>) -> Result<(), ApiError> {
    active_provider(&state)
        .await
        .logout()
        .await
        .map_err(provider_err_into_api)
}

async fn list_apps(State(state): State<Arc<ServerState>>) -> Result<Json<Vec<AppEntry>>, ApiError> {
    active_provider(&state)
        .await
        .list_apps()
        .await
        .map(Json)
        .map_err(provider_err_into_api)
}

async fn list_connections(
    State(state): State<Arc<ServerState>>,
) -> Result<Json<Vec<Connection>>, ApiError> {
    active_provider(&state)
        .await
        .list_connections()
        .await
        .map(Json)
        .map_err(provider_err_into_api)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectAppRequest {
    slug: String,
}

async fn connect_app(
    State(state): State<Arc<ServerState>>,
    Json(req): Json<ConnectAppRequest>,
) -> Result<Json<AppConnectionFlow>, ApiError> {
    active_provider(&state)
        .await
        .connect_app(&req.slug)
        .await
        .map(Json)
        .map_err(provider_err_into_api)
}

async fn disconnect_app(
    State(state): State<Arc<ServerState>>,
    Path(slug): Path<String>,
) -> Result<(), ApiError> {
    active_provider(&state)
        .await
        .disconnect_app(&slug)
        .await
        .map_err(provider_err_into_api)
}

async fn mcp_endpoint(
    State(state): State<Arc<ServerState>>,
) -> Result<Json<McpEndpoint>, ApiError> {
    active_provider(&state)
        .await
        .mcp_endpoint()
        .await
        .map(Json)
        .map_err(provider_err_into_api)
}

/// Translate the rich provider taxonomy into HTTP-friendly errors. We embed
/// the original variant tag into the message so the frontend can keep its
/// per-variant card rendering (NotInstalled → install nudge, Forbidden →
/// "the provider rejected this — try re-signing in", etc.).
fn provider_err_into_api(err: houston_integrations::ProviderError) -> ApiError {
    use houston_integrations::ProviderError;
    let prefix = match &err {
        ProviderError::NotInstalled { .. } => "not_installed",
        ProviderError::Unauthenticated { .. } => "unauthenticated",
        ProviderError::Forbidden { .. } => "forbidden",
        ProviderError::Upstream { .. } => "upstream",
        ProviderError::UnknownApp { .. } => "unknown_app",
        ProviderError::Local { .. } => "local",
        ProviderError::Internal { .. } => "internal",
    };
    ApiError(houston_engine_core::CoreError::Internal(format!(
        "{prefix}: {err}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ServerConfig;

    #[test]
    fn provider_for_returns_correct_implementations() {
        assert_eq!(provider_for(ProviderId::Composio).id(), ProviderId::Composio);
        assert_eq!(provider_for(ProviderId::Merge).id(), ProviderId::Merge);
    }

    fn test_config() -> ServerConfig {
        let home = tempfile::TempDir::new().unwrap();
        let docs = tempfile::TempDir::new().unwrap();
        // Leak the TempDirs — the test process exits immediately afterward
        // anyway, so OS cleanup handles them. Avoids carrying a guard around
        // every test helper.
        let cfg = ServerConfig {
            bind: "127.0.0.1:0".parse().unwrap(),
            token: "integrations-test".into(),
            home_dir: home.path().to_path_buf(),
            docs_dir: docs.path().to_path_buf(),
            app_system_prompt: String::new(),
            app_onboarding_prompt: String::new(),
            tunnel_url: "http://test.invalid".into(),
        };
        std::mem::forget(home);
        std::mem::forget(docs);
        cfg
    }

    async fn mem_state() -> ServerState {
        ServerState::new_in_memory(test_config())
            .await
            .expect("in-memory state")
    }

    #[tokio::test]
    async fn resolve_active_defaults_to_composio_when_pref_missing() {
        let state = mem_state().await;
        assert_eq!(resolve_active(&state).await, ProviderId::Composio);
    }

    #[tokio::test]
    async fn resolve_active_reads_persisted_pref() {
        let state = mem_state().await;
        preferences::set(&state.engine.db, ACTIVE_PROVIDER_PREF, "merge")
            .await
            .unwrap();
        assert_eq!(resolve_active(&state).await, ProviderId::Merge);
    }

    #[tokio::test]
    async fn resolve_active_falls_back_on_garbage_value() {
        // A previous Houston version or a manual DB edit could leave a
        // value the current enum doesn't recognize. Treat as "use default".
        let state = mem_state().await;
        preferences::set(&state.engine.db, ACTIVE_PROVIDER_PREF, "wat")
            .await
            .unwrap();
        assert_eq!(resolve_active(&state).await, ProviderId::Composio);
    }

    #[tokio::test]
    async fn resolve_active_trims_whitespace() {
        // Frontend may accidentally PUT with trailing newline; don't make the
        // user re-discover.
        let state = mem_state().await;
        preferences::set(&state.engine.db, ACTIVE_PROVIDER_PREF, "  merge  \n")
            .await
            .unwrap();
        assert_eq!(resolve_active(&state).await, ProviderId::Merge);
    }

    #[test]
    fn complete_login_accepts_camelcase_wire_shape() {
        // Frontend sends `{completionKey: "..."}` via the engine-client
        // request helper. A missing `#[serde(rename_all = "camelCase")]`
        // on the struct returns 422 from axum before the handler even
        // runs — caught us once in dev; this regression test catches it
        // again if the attribute is ever stripped.
        let json = r#"{"completionKey":"abc123"}"#;
        let parsed: CompleteLogin = serde_json::from_str(json).expect("deserializes");
        assert_eq!(parsed.completion_key, "abc123");
    }

    #[test]
    fn connect_app_accepts_camelcase_wire_shape() {
        let json = r#"{"slug":"gmail"}"#;
        let parsed: ConnectAppRequest = serde_json::from_str(json).expect("deserializes");
        assert_eq!(parsed.slug, "gmail");
    }

    #[tokio::test]
    async fn set_active_provider_persists_and_round_trips() {
        let state = std::sync::Arc::new(mem_state().await);
        let resp = set_active_provider(
            axum::extract::State(state.clone()),
            axum::Json(SetActiveProviderRequest {
                id: ProviderId::Merge,
            }),
        )
        .await
        .map_err(|e| e.0.to_string())
        .expect("setter ok")
        .0;
        assert_eq!(resp.id, ProviderId::Merge);
        assert_eq!(resp.display_name, "Merge");
        assert_eq!(resolve_active(&state).await, ProviderId::Merge);
    }
}
