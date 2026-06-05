# Integrations providers — Composio, Merge, and the trait between them

Houston historically hard-wired Composio for every "let an agent use Gmail/Slack/Calendar/etc." call. After the May 2026 Composio incident (server-wide 403 on `composio login` for ~all users), we extracted a provider-agnostic trait so a second provider can run beside Composio (or replace it) without touching agents or the UI.

## Mental model

```
                ┌──────────────────────────────────────────┐
                │   houston-integrations                   │
                │   IntegrationsProvider (trait)           │
                │   ProviderStatus / LoginFlow /           │
                │   AppEntry / Connection / McpEndpoint    │
                └────────────┬──────────────┬──────────────┘
                             │              │
                ┌────────────┴────┐   ┌─────┴────────────┐
                │ houston-composio │   │  houston-merge   │
                │  ComposioProvider│   │   MergeProvider  │
                │  (CLI subprocess)│   │ (OAuth+PKCE+MCP) │
                └─────────┬────────┘   └────┬─────────────┘
                          │                 │
                ┌─────────┴─────────────────┴─────────────┐
                │  /v1/integrations/*  (provider-agnostic) │
                │  /v1/composio/*       (legacy, retained) │
                └──────────────────────────────────────────┘
```

The frontend talks to `/v1/integrations/*` and never names a specific provider. The engine consults the user's preference (default: Composio) and forwards every call through the trait.

## The trait

`engine/houston-integrations/src/lib.rs::IntegrationsProvider`.

| Method | What it does | Composio impl | Merge impl |
|---|---|---|---|
| `id()` | Stable enum | `Composio` | `Merge` |
| `display_name()` | UI label | "Composio" | "Merge" |
| `is_bundled()` | Skip install UX? | true if bundled CLI present | always true (no artifact) |
| `status()` | Cheap snapshot for UI poll | `composio whoami` parse | keychain blob check |
| `start_login()` | Begin provider sign-in | `composio login --no-wait` | open `/o/authorize/` + spawn loopback listener |
| `complete_login(key)` | Finish sign-in | `composio login --key <key>` | await loopback code, exchange at `/o/token/` |
| `logout()` | Wipe creds | `composio logout` | `keyring.delete_credential()` |
| `list_apps()` | Catalog grid | Composio REST `/api/v3/toolkits` | MCP `tools/list` collapsed by connector |
| `list_connections()` | Dashboard list | MCP `COMPOSIO_MANAGE_CONNECTIONS` | TODO — needs live account to enumerate |
| `connect_app(slug)` | Per-app OAuth | `composio link <slug> --no-wait` | invoke `<slug>_connect` tool, grab magic_link |
| `disconnect_app(slug)` | Revoke | currently "manage on composio.dev" | call `<slug>_disconnect` tool |
| `mcp_endpoint()` | Agent transport | URL from `~/.claude.json` + keychain token | `ah-api.merge.dev/mcp` + bearer from keychain |

Errors flow through the shared `ProviderError` taxonomy (`NotInstalled / Unauthenticated / Forbidden / Upstream / UnknownApp / Local / Internal`). Each provider classifies its native failures into these variants so the UI renders consistent cards regardless of which provider was active.

## Concrete provider notes

### `houston-composio` (the existing crate, now also implements the trait)

- 10 files (`apps.rs, auth.rs, cli.rs, commands.rs, connection_watcher.rs, install.rs, lifecycle.rs, mcp.rs, provider.rs, toolkits.rs`), bundles a per-arch CLI (~180 MB / arch in `Resources/bin/composio-<arch>/`)
- `commands.rs` (free-function API) is kept verbatim for backward compat with the current Tauri adapter + `/v1/composio/*` routes
- `provider.rs` is the new `IntegrationsProvider` wrapper. Composio's existing internals power it — no logic was rewritten
- Bundled-CLI status sourced from `houston_cli_bundle::bundled_composio_binary()`

### `houston-merge` (new)

- 3 files (`auth.rs, mcp.rs, provider.rs`) plus `lib.rs` — **zero bundled binaries**. Pure Rust running inside the engine
- `auth.rs`: RFC 7591 dynamic client registration + RFC 7636 PKCE (S256) + RFC 6749 authorization-code flow. Tokens persisted in OS keychain via `keyring` 3.x (Apple Keychain on macOS, Credential Manager on Windows, Secret Service / dbus on Linux)
- `mcp.rs`: minimal MCP JSON-RPC client over HTTP. Handles both `application/json` and `text/event-stream` responses (the spec allows either)
- `provider.rs`: trait impl + a tiny embedded HTTP server (`tokio::net::TcpListener` bound to `127.0.0.1:0`) that captures the OAuth callback. State validated, code piped to `complete_login` via a `oneshot` channel
- Endpoints: `https://ah-api.merge.dev/o/{register,authorize,token}/` and `https://ah-api.merge.dev/mcp`. Centralised in `MergeEndpoints::PRODUCTION` so tests/staging can override

### Why Merge needs no bundle

Composio ships an opinionated CLI (Bun-compiled, per-arch) that handles its own OAuth, keychain, MCP wiring. Houston historically hosted that CLI as a subprocess to inherit all of it for free.

Merge's CLI is a thin convenience wrapper around their hosted MCP for IDE users (Cursor, Claude Code). Houston is a full desktop app with its own engine, MCP client, OAuth handling, and keychain — every piece of that wrapper. So we talk to the MCP endpoint directly and skip the Python CLI entirely. Result: no bundle, no notarization, no version drift between bundled CLI and server.

This is why today's incident pattern (bundled-CLI version gets 403'd by server-side change) **cannot happen** with Merge — the only "client" is our own Rust code, which we ship with every Houston release.

## Routes

- **Legacy `/v1/composio/*`** in `engine/houston-engine-server/src/routes/composio.rs` — direct forwarder to `houston_composio::commands::*`. Untouched.
- **New `/v1/integrations/*`** in `engine/houston-engine-server/src/routes/integrations.rs` — provider-agnostic. Reads the active provider from preferences (default Composio for backward compat), instantiates the right `Arc<dyn IntegrationsProvider>`, forwards the call.

Both surfaces serve the same database / keychain / etc. Picking a provider doesn't require deleting the other.

## Adding a third provider

1. New crate `engine/houston-<name>/` with three files: `auth.rs`, `mcp.rs` (or whatever transport), `provider.rs`
2. Add `<Name>` variant to `ProviderId` in `houston-integrations/src/lib.rs`
3. Implement `IntegrationsProvider` for your provider struct
4. In `engine/houston-engine-server/src/routes/integrations.rs::provider_for`, add a match arm constructing your provider
5. Add unit tests for slug classification + error mapping
6. Cross-check on Windows: `cargo check --target x86_64-pc-windows-gnu -p houston-<name>`

That's it. No agent code changes, no UI changes, no protocol changes — the trait is the contract.

## Sign-in flow + provider-aware system prompt (latest pass)

- **Sign-in works for both providers.** `app/src/hooks/use-integrations-auth.ts` mirrors `useComposioAuth` but talks to `/v1/integrations/login` + `/v1/integrations/login/complete`, so whichever provider is active handles the flow. `integrations-view.tsx` now has two branches (`ComposioPanel`, `MergePanel`) that route entirely through their respective REST surfaces. Picker toggles trigger an instant re-render without page reload.
- **No CLI bundling for Merge.** Confirmed by `MergeProvider::is_bundled()` returning `true` (nothing to install) and the Merge panel skipping the `NotInstalledState` card. The whole Merge flow is pure Rust HTTP + OAuth from the engine.
- **System prompt follows the active provider.** Per-provider operational guidance moved from the Houston app into the integrations provider crates (`houston_composio::COMPOSIO_GUIDANCE`, `houston_merge::MERGE_GUIDANCE`). The engine reads the active-provider preference at session-spawn time via `houston_engine_server::compose_app_system_prompt(state)` and appends the right text — `<base Houston identity> + <active provider's guidance>`. A runtime switch via the picker takes effect on the very next session start without an engine restart. Three new prompt-composition tests (default falls back to Composio, Merge appends Merge guidance, empty base still works) cover this. The app's `houston_prompt::system_prompt()` no longer concatenates `COMPOSIO_GUIDANCE` — that constant moved to `engine/houston-composio/src/guidance.rs` next to the provider it instructs.

## What was closed in the gap-closure pass

- **Preferences persistence (done)**. The active provider id is stored under `preferences::"integrations.active_provider"` and resolved on every request to `/v1/integrations/*`. Garbage values fall back to Composio with a `tracing::error!` so we see drift via telemetry without breaking the UI.
- **Merge per-connector catalog (done)**. `engine/houston-merge/src/catalog.rs` holds branded names + descriptions + real logo URLs for the 30+ most-used connectors (Gmail, Slack, GitHub, Calendar, Drive, Notion, Linear, Asana, Jira, Confluence, Trello, HubSpot, Salesforce, Outlook, Teams, OneDrive, Discord, Telegram, Airtable, Dropbox, Stripe, Shopify, Intercom, Zendesk, monday.com, LinkedIn, X, Figma, plus aliases). Slugs not in the catalog fall back to a prettified slug + favicon-by-domain — the previous default behavior.
- **Merge `list_connections` introspection (done)**. The provider now scans `tools/list` for a small set of known connection-introspection tool names (`list_connected_accounts`, `connections_list`, `list_connections`, `get_connections`, `*_list_accounts`) and calls the first match. Parses three response shapes (bare array, `connections` wrapper, MCP `content[0].text` JSON-in-string) so we tolerate schema variation across Merge releases. Returns an empty list with a `tracing::debug!` when no introspection tool exists — the user sees the right "no connections yet" state rather than an error.
- **Frontend provider picker (done)**. `app/src/components/integrations/provider-picker.tsx` ships two pieces: a compact "Powered by Composio / Merge" pill at the top of the Integrations view, and a dialog with two cards (one per provider). Tapping a non-active card calls `/v1/integrations/active` and invalidates the existing Composio queries so the panel re-renders against the newly active provider with no manual refresh. EN/ES/PT translations included; the no-em-dashes rule is respected throughout the new copy.

## Testing

- Unit tests in each crate (`cargo test -p houston-integrations -p houston-composio -p houston-merge`) — 28 tests total
- Integration test in `houston-integrations/tests/trait_object.rs` — proves both providers are object-safe and trait-compliant at compile time
- Cross-platform check: `cargo check --target x86_64-pc-windows-gnu -p houston-engine-server` — every crate (including the engine binary) compiles for Windows

## Files

- `engine/houston-integrations/` — trait + types + error taxonomy
- `engine/houston-merge/` — Merge implementation (OAuth+PKCE+MCP, no bundle)
- `engine/houston-composio/src/provider.rs` — Composio wrapper (existing internals untouched)
- `engine/houston-engine-server/src/routes/integrations.rs` — provider-agnostic REST surface
- `engine/houston-engine-server/src/routes/composio.rs` — legacy direct-Composio surface (retained)
