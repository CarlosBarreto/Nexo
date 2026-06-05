//! OAuth 2.0 + PKCE + Dynamic Client Registration against Merge Agent Handler.
//!
//! Flow (per RFC 8414 / RFC 7591 / RFC 7636):
//! 1. **Register** (once per Houston install): `POST /o/register/` → get a
//!    `client_id`. Persisted in the OS keychain so subsequent launches reuse it.
//! 2. **Authorize**: generate PKCE pair, open `/o/authorize/?...&code_challenge=...`
//!    in the user's default browser, run a local HTTP listener on
//!    `127.0.0.1:<random>/callback` to capture the redirect with the auth `code`.
//! 3. **Exchange**: `POST /o/token/` with `grant_type=authorization_code`,
//!    `code_verifier=<pkce_verifier>` → `access_token` + `refresh_token`.
//! 4. **Refresh** (silent, before expiry): `POST /o/token/` with
//!    `grant_type=refresh_token`.
//!
//! All persistence (client_id, access/refresh tokens, expiry, redirect_uri) lives
//! in a single JSON blob in the OS keychain — Apple Keychain on macOS, Credential
//! Manager on Windows, Secret Service on Linux — via the cross-platform `keyring`
//! crate. No files on disk.
//!
//! Designed against the real endpoints probed at
//! `https://ah-api.merge.dev/.well-known/oauth-protected-resource` (issuer + endpoints
//! returned by `/.well-known/oauth-authorization-server` on the same host).

use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::MergeEndpoints;

const KEYRING_SERVICE: &str = "houston-merge";
const KEYRING_USER: &str = "default";

/// Persisted auth state. Single keychain entry stores this as JSON.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedAuth {
    /// `client_id` from dynamic registration. None if we've never registered.
    pub client_id: Option<String>,
    /// Most recent valid access token (may be expired — caller refreshes).
    pub access_token: Option<String>,
    /// Refresh token (long-lived).
    pub refresh_token: Option<String>,
    /// Unix epoch seconds when access_token expires. 0 if unknown.
    pub access_token_expires_at: u64,
    /// The exact redirect_uri we registered + used. We MUST send the same one
    /// on every authorize + token request or the server rejects with
    /// `invalid_grant`. Stored so we can reconstitute it across launches.
    pub redirect_uri: Option<String>,
}

/// Pending login flow state we hand back to the caller. The caller opens
/// `authorization_url`, runs a local HTTP listener on the redirect_uri, captures
/// the `code` query param, and feeds it to [`exchange_code`].
pub struct PendingLogin {
    pub authorization_url: String,
    pub pkce_verifier: String,
    pub state: String,
    pub redirect_uri: String,
    pub client_id: String,
}

/// Read the persisted auth blob from the OS keychain. Missing-entry is treated
/// as "no auth yet" (returns Default).
pub fn load_auth() -> Result<PersistedAuth, AuthError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AuthError::Keychain(format!("open keychain entry: {e}")))?;
    match entry.get_password() {
        Ok(json) => serde_json::from_str(&json)
            .map_err(|e| AuthError::Keychain(format!("parse keychain JSON: {e}"))),
        Err(keyring::Error::NoEntry) => Ok(PersistedAuth::default()),
        Err(e) => Err(AuthError::Keychain(format!("read keychain entry: {e}"))),
    }
}

/// Overwrite the keychain entry with `auth`.
pub fn save_auth(auth: &PersistedAuth) -> Result<(), AuthError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AuthError::Keychain(format!("open keychain entry: {e}")))?;
    let json = serde_json::to_string(auth)
        .map_err(|e| AuthError::Keychain(format!("serialize auth: {e}")))?;
    entry
        .set_password(&json)
        .map_err(|e| AuthError::Keychain(format!("write keychain entry: {e}")))
}

/// Delete the keychain entry (logout).
pub fn clear_auth() -> Result<(), AuthError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AuthError::Keychain(format!("open keychain entry: {e}")))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AuthError::Keychain(format!("delete keychain entry: {e}"))),
    }
}

/// Per RFC 7591 — dynamically register Houston as an OAuth client.
/// Houston is a "public" client (no secret); auth is bound by PKCE only.
///
/// `redirect_uri` should be a `http://127.0.0.1:<port>/callback` URL bound by
/// the local listener the caller will start when initiating login. The registered
/// URI MUST exactly match every later authorize / token request.
pub async fn register_client(
    endpoints: &MergeEndpoints,
    redirect_uri: &str,
) -> Result<String, AuthError> {
    #[derive(Serialize)]
    struct RegisterReq<'a> {
        client_name: &'a str,
        redirect_uris: Vec<&'a str>,
        token_endpoint_auth_method: &'a str,
        grant_types: Vec<&'a str>,
        response_types: Vec<&'a str>,
    }

    #[derive(Deserialize)]
    struct RegisterResp {
        client_id: String,
    }

    let req = RegisterReq {
        client_name: "Houston",
        redirect_uris: vec![redirect_uri],
        token_endpoint_auth_method: "none",
        grant_types: vec!["authorization_code", "refresh_token"],
        response_types: vec!["code"],
    };

    let resp: RegisterResp = http_client()
        .post(endpoints.registration)
        .json(&req)
        .send()
        .await
        .map_err(|e| AuthError::Http(format!("register POST: {e}")))?
        .error_for_status()
        .map_err(|e| AuthError::Http(format!("register status: {e}")))?
        .json()
        .await
        .map_err(|e| AuthError::Http(format!("register JSON: {e}")))?;

    Ok(resp.client_id)
}

/// Generate a fresh PKCE verifier (43-128 unreserved chars per RFC 7636 §4.1).
/// We use 64 bytes of randomness → 86 chars base64url-no-pad → comfortably within.
pub fn generate_pkce_verifier() -> String {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Derive the S256 challenge from a verifier.
pub fn derive_pkce_challenge(verifier: &str) -> String {
    let hash = sha2::Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash)
}

/// Random state token for CSRF protection on the authorize redirect.
pub fn generate_state() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Build the authorize URL the user opens in a browser.
pub fn authorization_url(
    endpoints: &MergeEndpoints,
    client_id: &str,
    redirect_uri: &str,
    pkce_challenge: &str,
    state: &str,
) -> String {
    let mut url = url::Url::parse(endpoints.authorization)
        .expect("authorization endpoint is a valid static URL");
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("code_challenge", pkce_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state);
    url.into()
}

/// Exchange the auth `code` (captured by the local callback listener) for
/// access + refresh tokens. Persists the result via [`save_auth`].
pub async fn exchange_code(
    endpoints: &MergeEndpoints,
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    pkce_verifier: &str,
) -> Result<PersistedAuth, AuthError> {
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id),
        ("code_verifier", pkce_verifier),
    ];

    let resp = http_client()
        .post(endpoints.token)
        .form(&form)
        .send()
        .await
        .map_err(|e| AuthError::Http(format!("token POST: {e}")))?;

    parse_token_response(resp, client_id, redirect_uri).await
}

/// Refresh an expired access token using the stored refresh_token. Persists the
/// new tokens. Returns the new access_token on success.
pub async fn refresh_token(endpoints: &MergeEndpoints) -> Result<String, AuthError> {
    let mut auth = load_auth()?;
    let refresh = auth
        .refresh_token
        .clone()
        .ok_or_else(|| AuthError::NoRefreshToken)?;
    let client_id = auth
        .client_id
        .clone()
        .ok_or_else(|| AuthError::Unregistered)?;
    let redirect_uri = auth
        .redirect_uri
        .clone()
        .ok_or_else(|| AuthError::Unregistered)?;

    let form = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh.as_str()),
        ("client_id", client_id.as_str()),
    ];

    let resp = http_client()
        .post(endpoints.token)
        .form(&form)
        .send()
        .await
        .map_err(|e| AuthError::Http(format!("refresh POST: {e}")))?;

    let new = parse_token_response(resp, &client_id, &redirect_uri).await?;
    // Some IdPs rotate refresh_tokens, some don't. Keep the old one if the
    // server omitted a new one in the response.
    if new.refresh_token.is_none() {
        auth.access_token = new.access_token.clone();
        auth.access_token_expires_at = new.access_token_expires_at;
        save_auth(&auth)?;
        auth.access_token
            .ok_or(AuthError::Internal("token response missing access_token".into()))
    } else {
        save_auth(&new)?;
        new.access_token
            .ok_or(AuthError::Internal("token response missing access_token".into()))
    }
}

/// Return a valid access token, transparently refreshing if expired.
pub async fn valid_access_token(
    endpoints: &MergeEndpoints,
) -> Result<String, AuthError> {
    let auth = load_auth()?;
    let token = auth.access_token.ok_or(AuthError::NoAccessToken)?;
    let now = now_unix();
    // Refresh ≥30s early so concurrent calls don't both hit the wire with an
    // about-to-expire token.
    if auth.access_token_expires_at > now + 30 {
        return Ok(token);
    }
    refresh_token(endpoints).await
}

async fn parse_token_response(
    resp: reqwest::Response,
    client_id: &str,
    redirect_uri: &str,
) -> Result<PersistedAuth, AuthError> {
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AuthError::Http(format!("token body: {e}")))?;
    if !status.is_success() {
        return Err(AuthError::TokenExchange(format!(
            "status={status} body={body}"
        )));
    }

    #[derive(Deserialize)]
    struct TokenResp {
        access_token: String,
        refresh_token: Option<String>,
        #[serde(default)]
        expires_in: Option<u64>,
    }

    let resp: TokenResp = serde_json::from_str(&body)
        .map_err(|e| AuthError::TokenExchange(format!("parse JSON: {e}; body={body}")))?;

    Ok(PersistedAuth {
        client_id: Some(client_id.to_string()),
        access_token: Some(resp.access_token),
        refresh_token: resp.refresh_token,
        access_token_expires_at: now_unix() + resp.expires_in.unwrap_or(3600),
        redirect_uri: Some(redirect_uri.to_string()),
    })
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("houston-merge/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .expect("reqwest client builds")
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("keychain: {0}")]
    Keychain(String),
    #[error("http: {0}")]
    Http(String),
    #[error("token exchange failed: {0}")]
    TokenExchange(String),
    #[error("no refresh token available — user must log in")]
    NoRefreshToken,
    #[error("no access token available — user must log in")]
    NoAccessToken,
    #[error("not registered — call register_client first")]
    Unregistered,
    #[error("internal: {0}")]
    Internal(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_verifier_is_url_safe_and_correct_length() {
        let v = generate_pkce_verifier();
        // 64 random bytes → 86 base64url-no-pad chars.
        assert_eq!(v.len(), 86);
        assert!(v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        // RFC 7636 appendix B sample
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
        assert_eq!(derive_pkce_challenge(verifier), expected);
    }

    #[test]
    fn authorization_url_includes_required_params() {
        let url = authorization_url(
            &MergeEndpoints::PRODUCTION,
            "test-client-id",
            "http://127.0.0.1:1234/callback",
            "challenge-abc",
            "state-xyz",
        );
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=test-client-id"));
        assert!(url.contains("code_challenge=challenge-abc"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=state-xyz"));
        assert!(url.starts_with("https://ah-api.merge.dev/o/authorize/"));
    }

    #[test]
    fn state_token_is_random() {
        let a = generate_state();
        let b = generate_state();
        assert_ne!(a, b);
        assert!(a.len() >= 32);
    }
}
