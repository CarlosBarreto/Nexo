//! Security-scan a skill with the bundled NVIDIA SkillSpector before (or
//! after) it is installed.
//!
//! All three entry points end at [`scan_skill_markdown`], which writes the
//! `SKILL.md` to a throwaway directory and runs the bundled scanner. The
//! scan is intentionally split from install: the desktop scans first, shows
//! the verdict, and only installs on the user's confirmation (the
//! gate-with-override flow). On a device without the bundled scanner (e.g.
//! an Intel Mac in v1) the result is [`ScanOutcome::Unavailable`] — not an
//! error — so install can proceed without a pre-scan.

use crate::SkillError;

// Re-export the typed scan model so engine-core can map it to wire DTOs
// without taking a direct dependency on the inspector crate.
pub use houston_skill_inspector::{
    Issue, IssueLocation, Recommendation, RiskAssessment, ScanReport, Severity,
};

/// Result of a scan request.
pub enum ScanOutcome {
    /// The scanner ran and produced a verdict (clean or flagged).
    Scanned(ScanReport),
    /// SkillSpector isn't bundled on this device, so no scan was run.
    /// Callers proceed without a pre-install safety check.
    Unavailable,
}

/// Scan raw `SKILL.md` content. Writes it to a temp directory and runs the
/// bundled scanner.
pub async fn scan_skill_markdown(raw_md: &str) -> Result<ScanOutcome, SkillError> {
    let dir = tempfile::tempdir().map_err(|e| SkillError::Io(e.to_string()))?;
    std::fs::write(dir.path().join("SKILL.md"), raw_md).map_err(|e| SkillError::Io(e.to_string()))?;

    match houston_skill_inspector::scan_skill_dir(dir.path()).await {
        Ok(report) => Ok(ScanOutcome::Scanned(report)),
        // The scanner isn't bundled here — an absent feature, not a failure.
        Err(houston_skill_inspector::InspectorError::Unavailable) => Ok(ScanOutcome::Unavailable),
        // A real failure (spawn / timeout / unreadable output) must surface.
        Err(e) => Err(SkillError::ScanFailed(e.to_string())),
    }
}

/// Scan a community skill (skills.sh) by fetching its `SKILL.md` the same
/// way `install_skill` does.
pub async fn scan_community_skill(source: &str, skill_id: &str) -> Result<ScanOutcome, SkillError> {
    let client = crate::remote::build_client()?;
    let raw_md = crate::remote::fetch_community_skill_md(&client, source, skill_id).await?;
    scan_skill_markdown(&raw_md).await
}

/// Scan a skill discovered in a GitHub repo by fetching its `SKILL.md` at
/// the given in-repo path.
pub async fn scan_repo_skill(source: &str, path: &str) -> Result<ScanOutcome, SkillError> {
    let normalized = crate::remote::normalize_source(source)
        .ok_or_else(|| SkillError::InvalidRepoSource(source.trim().to_string()))?;
    let client = crate::remote::build_client()?;
    let raw_md = crate::remote::fetch_skill_md_at_path(&client, &normalized, path).await?;
    scan_skill_markdown(&raw_md).await
}

/// Re-scan a skill already installed under `skills_dir` (an on-demand
/// "check this skill" from the Skills tab).
pub async fn scan_installed_skill(
    skills_dir: &std::path::Path,
    name: &str,
) -> Result<ScanOutcome, SkillError> {
    let path = skills_dir.join(name).join("SKILL.md");
    let raw_md = std::fs::read_to_string(&path).map_err(|_| SkillError::NotFound(name.to_string()))?;
    scan_skill_markdown(&raw_md).await
}
