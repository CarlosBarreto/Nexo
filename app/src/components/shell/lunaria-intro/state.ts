/**
 * First-run flag for the Lunaria arcade intro.
 *
 * Stored in localStorage (NOT an engine preference) on purpose: the intro
 * renders as the outermost gate, BEFORE the engine handshake resolves, so the
 * "have they already seen it?" decision has to be synchronous and engine-free.
 *
 * Trade-off: a reinstall or a cleared WebView store re-shows the intro once.
 * That is acceptable for a one-time welcome, and mirrors how the locale boot
 * cache in `lib/i18n` treats localStorage as a best-effort, non-authoritative
 * store.
 */

const LUNARIA_INTRO_SEEN_KEY = "houston.lunaria.introSeen";
const SEEN_VALUE = "1";

/**
 * Whether the Lunaria intro has already played. Reads synchronously so the gate
 * can decide on the very first paint. If storage is unavailable (disabled /
 * quota / no DOM) we fail "seen" so a broken store can never trap the user on
 * the intro every single launch.
 */
export function hasSeenLunariaIntro(): boolean {
  try {
    return localStorage.getItem(LUNARIA_INTRO_SEEN_KEY) === SEEN_VALUE;
  } catch {
    return true;
  }
}

/** Persist that the intro has played. Best-effort; a storage failure is inert. */
export function markLunariaIntroSeen(): void {
  try {
    localStorage.setItem(LUNARIA_INTRO_SEEN_KEY, SEEN_VALUE);
  } catch {
    /* ignore quota / disabled storage */
  }
}
