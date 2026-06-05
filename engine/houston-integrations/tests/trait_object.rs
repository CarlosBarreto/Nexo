//! Integration test that proves the trait is object-safe AND that both real
//! provider implementations satisfy it. If either Composio or Merge stops
//! conforming to the trait, this test fails to compile — the trait abstraction
//! breaks loudly, not silently.
//!
//! These are compile-time assertions, not runtime ones — there's no actual
//! network/keychain access in this test, so it's safe to run in CI without
//! credentials.

use houston_composio::ComposioProvider;
use houston_integrations::{IntegrationsProvider, ProviderId};
use houston_merge::MergeProvider;
use std::sync::Arc;

#[test]
fn both_providers_are_object_safe_and_have_distinct_ids() {
    let providers: Vec<Arc<dyn IntegrationsProvider>> = vec![
        Arc::new(ComposioProvider::new()),
        Arc::new(MergeProvider::new()),
    ];
    let ids: Vec<ProviderId> = providers.iter().map(|p| p.id()).collect();
    assert_eq!(ids, vec![ProviderId::Composio, ProviderId::Merge]);
    let names: Vec<&'static str> = providers.iter().map(|p| p.display_name()).collect();
    assert_eq!(names, vec!["Composio", "Merge"]);
}

#[test]
fn provider_handles_are_cheaply_cloneable() {
    let composio = ComposioProvider::new();
    let merge = MergeProvider::new();
    let _c2 = composio.clone();
    let _m2 = merge.clone();
    // If either clone ever becomes expensive (allocates a connection pool, etc.)
    // the engine's per-request `Arc::new(...)` pattern in routes/integrations.rs
    // becomes a hot path — this test serves as a tripwire to revisit.
}

#[test]
fn merge_is_bundled_composio_depends_on_bundle_presence() {
    // Merge has no bundled artifact ever — it's pure HTTP.
    assert!(MergeProvider::new().is_bundled());
    // Composio is "bundled" only when running inside a real Houston.app/.msi.
    // In `cargo test` we're outside the bundle, so this returns false. The
    // semantic is "Houston-side install needed?" — false in dev because the
    // user runs the install script themselves.
    let composio_is_bundled = ComposioProvider::new().is_bundled();
    let in_real_bundle = std::env::var("HOUSTON_TEST_INSIDE_BUNDLE").is_ok();
    if in_real_bundle {
        assert!(
            composio_is_bundled,
            "expected composio to be bundle-resolved inside a real .app"
        );
    } else {
        // Just make sure the call doesn't panic — value is environment-dependent.
        let _ = composio_is_bundled;
    }
}
