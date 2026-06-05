//! Static catalog of Merge Agent Handler connectors.
//!
//! The MCP `tools/list` endpoint returns tool names but not friendly metadata
//! (display name, real logo, short description). To keep the user-facing app
//! grid visually identical regardless of which provider is active, we maintain
//! this static table in parallel with `houston-composio::mcp::toolkit_meta`.
//!
//! Entries cover the most-used connectors Houston references today (see
//! `knowledge-base/integrations-providers.md` for the ranked list). Anything
//! we discover at runtime that isn't here falls back to a prettified slug +
//! a favicon-by-domain logo — the previous behavior.
//!
//! Slug names follow Merge Agent Handler's `<connector>_<action>` tool naming
//! (e.g. tool `gmail_send_email` → connector slug `gmail`). If Merge ever
//! renames a connector slug, add the new name here; the lookup is
//! pure-data so changes are mechanical.

/// One catalog entry. Fields match `houston-integrations::AppEntry`.
#[derive(Debug, Clone, Copy)]
pub struct CatalogEntry {
    pub display_name: &'static str,
    pub description: &'static str,
    pub logo_url: &'static str,
}

/// Look up branded metadata for a connector slug. `None` means we have no
/// entry — caller falls back to slug-derived defaults.
pub fn lookup(slug: &str) -> Option<CatalogEntry> {
    CATALOG.iter().find(|(s, _)| *s == slug).map(|(_, e)| *e)
}

/// Canonical brand asset URLs. Same logos Composio uses (Google's gstatic,
/// vendor-hosted icons) so the grid looks visually consistent across providers.
const CATALOG: &[(&str, CatalogEntry)] = &[
    (
        "gmail",
        CatalogEntry {
            display_name: "Gmail",
            description: "Send and read emails",
            logo_url: "https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png",
        },
    ),
    (
        "googlecalendar",
        CatalogEntry {
            display_name: "Google Calendar",
            description: "Manage events and schedules",
            logo_url: "https://www.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png",
        },
    ),
    (
        "calendar",
        CatalogEntry {
            display_name: "Google Calendar",
            description: "Manage events and schedules",
            logo_url: "https://www.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png",
        },
    ),
    (
        "googledrive",
        CatalogEntry {
            display_name: "Google Drive",
            description: "Access files and folders",
            logo_url: "https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png",
        },
    ),
    (
        "drive",
        CatalogEntry {
            display_name: "Google Drive",
            description: "Access files and folders",
            logo_url: "https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png",
        },
    ),
    (
        "googledocs",
        CatalogEntry {
            display_name: "Google Docs",
            description: "Read and edit documents",
            logo_url: "https://www.gstatic.com/images/branding/product/2x/docs_2020q4_48dp.png",
        },
    ),
    (
        "googlesheets",
        CatalogEntry {
            display_name: "Google Sheets",
            description: "Read and edit spreadsheets",
            logo_url: "https://www.gstatic.com/images/branding/product/2x/sheets_2020q4_48dp.png",
        },
    ),
    (
        "slack",
        CatalogEntry {
            display_name: "Slack",
            description: "Send and read messages",
            logo_url: "https://a.slack-edge.com/80588/marketing/img/meta/slack_hash_256.png",
        },
    ),
    (
        "github",
        CatalogEntry {
            display_name: "GitHub",
            description: "Manage repos and issues",
            logo_url: "https://github.githubassets.com/assets/GitHub-Mark-ea2971cee799.png",
        },
    ),
    (
        "gitlab",
        CatalogEntry {
            display_name: "GitLab",
            description: "Manage repos and merge requests",
            logo_url: "https://about.gitlab.com/images/press/press-kit-icon.svg",
        },
    ),
    (
        "notion",
        CatalogEntry {
            display_name: "Notion",
            description: "Access pages and databases",
            logo_url: "https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png",
        },
    ),
    (
        "linear",
        CatalogEntry {
            display_name: "Linear",
            description: "Track issues and projects",
            logo_url: "https://linear.app/static/apple-touch-icon.png",
        },
    ),
    (
        "asana",
        CatalogEntry {
            display_name: "Asana",
            description: "Track tasks and projects",
            logo_url: "https://asana.com/images/fav/apple-touch-icon.png",
        },
    ),
    (
        "jira",
        CatalogEntry {
            display_name: "Jira",
            description: "Track issues and sprints",
            logo_url: "https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/apple-touch-icon.png",
        },
    ),
    (
        "confluence",
        CatalogEntry {
            display_name: "Confluence",
            description: "Read and edit knowledge pages",
            logo_url: "https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/apple-touch-icon.png",
        },
    ),
    (
        "trello",
        CatalogEntry {
            display_name: "Trello",
            description: "Manage boards and cards",
            logo_url: "https://trello.com/apple-touch-icon.png",
        },
    ),
    (
        "hubspot",
        CatalogEntry {
            display_name: "HubSpot",
            description: "Manage contacts and deals",
            logo_url: "https://www.hubspot.com/hubfs/HubSpot_Logos/HubSpot-Inversed-Favicon.png",
        },
    ),
    (
        "salesforce",
        CatalogEntry {
            display_name: "Salesforce",
            description: "Manage contacts, accounts, opportunities",
            logo_url: "https://www.salesforce.com/favicon.ico",
        },
    ),
    (
        "outlook",
        CatalogEntry {
            display_name: "Outlook",
            description: "Send and read emails",
            logo_url: "https://outlook.live.com/favicon.ico",
        },
    ),
    (
        "microsoftteams",
        CatalogEntry {
            display_name: "Microsoft Teams",
            description: "Send messages and manage channels",
            logo_url: "https://statics.teams.cdn.office.net/hashedassets-launcher/launcher_app_icon_v2.png",
        },
    ),
    (
        "onedrive",
        CatalogEntry {
            display_name: "OneDrive",
            description: "Access files and folders",
            logo_url: "https://res.cdn.office.net/assets/mail/pwa/v1/pngs/favicon_onedrive.ico",
        },
    ),
    (
        "discord",
        CatalogEntry {
            display_name: "Discord",
            description: "Send and read messages",
            logo_url: "https://assets-global.website-files.com/6257adef93867e50d84d30e2/636e0a69f118df70ad7828d4_icon_clyde_blurple_RGB.svg",
        },
    ),
    (
        "telegram",
        CatalogEntry {
            display_name: "Telegram",
            description: "Send and read messages",
            logo_url: "https://telegram.org/img/t_logo.png",
        },
    ),
    (
        "airtable",
        CatalogEntry {
            display_name: "Airtable",
            description: "Access tables and records",
            logo_url: "https://airtable.com/images/favicon/baymax/apple-touch-icon.png",
        },
    ),
    (
        "dropbox",
        CatalogEntry {
            display_name: "Dropbox",
            description: "Access files and folders",
            logo_url: "https://cfl.dropboxstatic.com/static/metaserver/static/images/favicon-vfl8lUR9B.ico",
        },
    ),
    (
        "stripe",
        CatalogEntry {
            display_name: "Stripe",
            description: "Manage payments and customers",
            logo_url: "https://stripe.com/favicon.ico",
        },
    ),
    (
        "shopify",
        CatalogEntry {
            display_name: "Shopify",
            description: "Manage products and orders",
            logo_url: "https://cdn.shopify.com/shopifycloud/web/assets/v1/favicon.ico",
        },
    ),
    (
        "intercom",
        CatalogEntry {
            display_name: "Intercom",
            description: "Manage conversations and contacts",
            logo_url: "https://www.intercom.com/favicon.ico",
        },
    ),
    (
        "zendesk",
        CatalogEntry {
            display_name: "Zendesk",
            description: "Manage tickets and customers",
            logo_url: "https://www.zendesk.com/favicon.ico",
        },
    ),
    (
        "monday",
        CatalogEntry {
            display_name: "monday.com",
            description: "Manage boards and items",
            logo_url: "https://monday.com/static/img/favicon.ico",
        },
    ),
    (
        "linkedin",
        CatalogEntry {
            display_name: "LinkedIn",
            description: "Post updates and read messages",
            logo_url: "https://static-exp1.licdn.com/sc/h/akt4ae504epesldzj74dzred8",
        },
    ),
    (
        "twitter",
        CatalogEntry {
            display_name: "X (Twitter)",
            description: "Post tweets and read timeline",
            logo_url: "https://abs.twimg.com/favicons/twitter.3.ico",
        },
    ),
    (
        "x",
        CatalogEntry {
            display_name: "X (Twitter)",
            description: "Post tweets and read timeline",
            logo_url: "https://abs.twimg.com/favicons/twitter.3.ico",
        },
    ),
    (
        "figma",
        CatalogEntry {
            display_name: "Figma",
            description: "Read files and comments",
            logo_url: "https://static.figma.com/app/icon/1/favicon.svg",
        },
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn covers_houston_top_apps() {
        // Sanity check that the apps Houston references most (from
        // grep counts in the codebase) all resolve.
        for slug in &[
            "gmail",
            "slack",
            "github",
            "googlecalendar",
            "googledrive",
            "notion",
            "linear",
            "asana",
            "trello",
            "hubspot",
            "salesforce",
        ] {
            assert!(
                lookup(slug).is_some(),
                "catalog missing entry for top-used connector '{slug}'"
            );
        }
    }

    #[test]
    fn lookup_misses_unknown() {
        assert!(lookup("totally-fake-connector").is_none());
    }

    #[test]
    fn calendar_aliases_to_googlecalendar() {
        // Merge sometimes uses bare "calendar"; Composio uses "googlecalendar".
        // Both should resolve to the same display name so the user grid is
        // visually identical regardless of which provider is active.
        let bare = lookup("calendar").expect("calendar slug");
        let google = lookup("googlecalendar").expect("googlecalendar slug");
        assert_eq!(bare.display_name, google.display_name);
        assert_eq!(bare.logo_url, google.logo_url);
    }

    #[test]
    fn all_entries_have_https_logos() {
        for (slug, entry) in CATALOG {
            assert!(
                entry.logo_url.starts_with("https://"),
                "catalog entry '{slug}' has non-https logo: {}",
                entry.logo_url
            );
            assert!(!entry.display_name.is_empty(), "empty name for '{slug}'");
            assert!(!entry.description.is_empty(), "empty description for '{slug}'");
        }
    }
}
