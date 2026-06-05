//! Provider-agnostic error taxonomy. Mirrors the spirit of
//! `houston-engine-core::ProviderError` (LLM providers) but lives separately so
//! the integrations layer stays decoupled from the LLM dispatch crate.
//!
//! Every concrete provider maps its native failures into one of these variants.
//! The frontend renders each variant with a dedicated card per the beta-stage
//! no-silent-failures policy.

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type ProviderResult<T> = Result<T, ProviderError>;

/// Why an integrations call failed. Order roughly: user-actionable → not.
#[derive(Debug, Clone, Error, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProviderError {
    /// The provider isn't installed / configured yet. UI nudges the user to
    /// install (Composio CLI) or onboard (Merge OAuth).
    #[error("provider not installed: {message}")]
    NotInstalled { message: String },

    /// The user is not signed in to the provider. Distinct from `Forbidden`:
    /// this is "you've never logged in" or "your session expired and refresh
    /// failed", not "the server rejected your authenticated request".
    #[error("provider not authenticated: {message}")]
    Unauthenticated { message: String },

    /// The provider's server returned a 403/permission denial on a request
    /// we believed was authenticated. Often signals server-side incident
    /// (e.g. Composio May 2026 key rotation that blanket-403'd every login).
    #[error("provider forbidden: {message}")]
    Forbidden { message: String },

    /// The provider's server returned a 5xx or otherwise indicated outage.
    /// UI shows status-page link if the provider has one.
    #[error("provider upstream error: {message}")]
    Upstream { message: String },

    /// The user's app/toolkit slug was rejected by the provider (typo,
    /// removed catalog entry, etc.).
    #[error("provider does not support app '{slug}'")]
    UnknownApp { slug: String },

    /// Local IO / subprocess / keychain failure. Doesn't fit the network-y
    /// buckets above. The message is shown to the user verbatim — implementations
    /// should make it actionable.
    #[error("provider local error: {message}")]
    Local { message: String },

    /// Catch-all for unexpected errors. Implementations should prefer the more
    /// specific variants above — this is for genuinely unanticipated states.
    #[error("provider internal error: {message}")]
    Internal { message: String },
}

impl ProviderError {
    /// Constructor convenience — most call sites use these instead of struct
    /// literals.
    pub fn unauthenticated(msg: impl Into<String>) -> Self {
        Self::Unauthenticated {
            message: msg.into(),
        }
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::Forbidden {
            message: msg.into(),
        }
    }

    pub fn upstream(msg: impl Into<String>) -> Self {
        Self::Upstream {
            message: msg.into(),
        }
    }

    pub fn local(msg: impl Into<String>) -> Self {
        Self::Local {
            message: msg.into(),
        }
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal {
            message: msg.into(),
        }
    }

    pub fn not_installed(msg: impl Into<String>) -> Self {
        Self::NotInstalled {
            message: msg.into(),
        }
    }

    pub fn unknown_app(slug: impl Into<String>) -> Self {
        Self::UnknownApp { slug: slug.into() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variants_serialize_with_snake_case_kind() {
        let cases = [
            (
                ProviderError::not_installed("composio CLI missing"),
                "not_installed",
            ),
            (ProviderError::unauthenticated("no token"), "unauthenticated"),
            (ProviderError::forbidden("server said no"), "forbidden"),
            (ProviderError::upstream("503 from merge"), "upstream"),
            (ProviderError::unknown_app("gmial"), "unknown_app"),
            (ProviderError::local("keychain error"), "local"),
            (ProviderError::internal("unexpected"), "internal"),
        ];
        for (err, expected_kind) in cases {
            let json = serde_json::to_string(&err).unwrap();
            assert!(
                json.contains(&format!("\"kind\":\"{expected_kind}\"")),
                "expected kind={expected_kind} in {json}"
            );
        }
    }

    #[test]
    fn display_includes_message() {
        let err = ProviderError::forbidden("403 trace abc");
        assert_eq!(err.to_string(), "provider forbidden: 403 trace abc");
    }
}
