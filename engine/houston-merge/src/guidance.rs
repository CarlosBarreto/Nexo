//! Agent-facing operational guidance for Merge.
//!
//! Appended to the per-session system prompt when Merge is the active
//! integrations provider. Tells the model HOW to discover + invoke tools
//! through Merge Agent Handler's MCP server, which is fundamentally
//! different from Composio's CLI-based discovery.
//!
//! Key differences from Composio:
//! - Merge tools are auto-loaded into the agent's MCP toolset; the agent
//!   does not run shell commands. Instead it calls tools natively (the
//!   same way it calls Read/Edit/etc.).
//! - When a connector is not yet linked, the tool invocation returns a
//!   Magic Link URL in the response. The agent surfaces it to the user
//!   like a connect card, similar to Composio's `redirect_url`.

/// Merge operational guidance. Starts with the standard `\n\n---\n\n`
/// separator so the caller can concatenate without thinking about spacing.
pub const MERGE_GUIDANCE: &str = "\n\n---\n\n# Integrations - Merge\n\n\
When a task needs a connected app or account, you have direct MCP tools \
available for every Merge connector the user has access to (Gmail, Slack, \
Google Calendar, Google Drive, GitHub, Notion, Linear, HubSpot, Salesforce, \
and more). Call them like any other tool, no shell commands needed.\n\n\
Quick reference:\n\
- Tool names follow `<connector>_<action>` (e.g. `gmail_send_email`, \
  `slack_post_message`, `googlecalendar_create_event`).\n\
- Inspect a tool's input schema the same way you would any other tool, \
  no special command needed.\n\n\
## When the user is not signed into Merge at all\n\n\
If a Merge tool call fails with an authentication / not-signed-in error \
(no active Merge session), DO NOT tell the user to open settings or visit \
a website. Instead, post a Merge sign-in card directly in chat by writing \
the markdown link exactly as: \
`[Sign in to Merge](https://app.merge.dev/#houston_merge_signin=1)`. \
The Houston chat renders this as a rich sign-in card with a one-click \
button. Then add ONE short line, e.g. \"I need you to sign into Merge \
first so I can use your apps.\" Wait for the user to confirm they're back, \
then retry the original tool call.\n\n\
## When an app is not connected\n\n\
If a Merge tool call returns a `magic_link` field (or a similar \
\"connect this app\" payload) instead of executing, the user has not yet \
linked that specific app. DO NOT open the browser yourself and DO NOT \
tell them to go to the Integrations tab. Instead:\n\n\
1. Offer to help connect the app right now and briefly say why, \
   e.g. \"I'd need Gmail connected so I can send this. Want me to help?\"\n\
2. If the user says yes, present the returned `magic_link` URL as a \
   markdown link. **IMPORTANT**: append `#houston_toolkit=<connector>` \
   to the URL so the Houston chat can render it as a rich connect card \
   with live connection status instead of a plain button. Example: for \
   a Gmail connect link, output exactly: \
   `[Connect Gmail](https://...?#houston_toolkit=gmail)`. The card \
   renders the app name + logo and handles the click for you.\n\
3. After they tell you they've approved in the browser, retry the \
   original tool call.";
