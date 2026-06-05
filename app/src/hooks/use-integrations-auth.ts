/**
 * Provider-agnostic sign-in flow.
 *
 * Mirrors `useComposioAuth` but talks to the active provider through
 * `/v1/integrations/login` + `/v1/integrations/login/complete`. Whether
 * the underlying provider is Composio (CLI subprocess that polls the
 * Composio backend) or Merge (loopback OAuth callback that waits for
 * the captured code) is invisible from this hook's perspective — the
 * trait surface guarantees the shape is identical.
 *
 * Flow:
 * 1. `integrationsStartLogin()` → `{login_url, completion_key}`.
 * 2. Open `login_url` in the user's default browser.
 * 3. `integrationsCompleteLogin(completion_key)` → blocks until the
 *    provider confirms the user finished signing in (Composio: CLI
 *    returns; Merge: loopback listener captures the code).
 * 4. Invalidate the integrations queries so the panel re-renders.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { getEngine } from "../lib/engine";
import { tauriSystem } from "../lib/tauri";
import { logger } from "../lib/logger";

export interface IntegrationsAuthState {
  open: boolean;
  /** Current phase of the flow. */
  phase: "idle" | "waiting" | "error";
  /** URL the user can click to open/re-open the provider sign-in page. */
  loginUrl: string | null;
  error: string | null;
}

export function useIntegrationsAuth(onSuccess: () => void | Promise<void>) {
  const [state, setState] = useState<IntegrationsAuthState>({
    open: false,
    phase: "idle",
    loginUrl: null,
    error: null,
  });

  // Generation counter — discard stale results if the user restarts the
  // flow before the previous attempt resolves.
  const genRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const startAuth = useCallback(async () => {
    const myGen = ++genRef.current;
    setState({ open: true, phase: "waiting", loginUrl: null, error: null });

    try {
      logger.info("[integrations-auth] calling startLogin...");
      const { login_url, completion_key } =
        await getEngine().integrationsStartLogin();
      logger.info(
        `[integrations-auth] startLogin returned: url=${login_url} key=${completion_key.slice(0, 8)}…`,
      );

      // Always surface the URL even if a re-render happened during the
      // backend call — the user expects to see the browser open.
      setState((s) => ({ ...s, loginUrl: login_url }));
      logger.info("[integrations-auth] opening browser...");
      try {
        await tauriSystem.openUrl(login_url);
        logger.info("[integrations-auth] openUrl resolved OK");
      } catch (urlErr) {
        logger.error("[integrations-auth] openUrl FAILED:", String(urlErr));
      }

      logger.info("[integrations-auth] calling completeLogin...");
      await getEngine().integrationsCompleteLogin(completion_key);
      logger.info("[integrations-auth] completeLogin resolved OK");
      if (!mountedRef.current || genRef.current !== myGen) {
        logger.info(
          "[integrations-auth] stale gen after completeLogin, not updating state",
        );
        return;
      }

      setState({ open: false, phase: "idle", loginUrl: null, error: null });
      await onSuccess();
    } catch (e) {
      logger.error("[integrations-auth] flow error:", String(e));
      if (!mountedRef.current || genRef.current !== myGen) return;
      setState((s) => ({
        ...s,
        phase: "error",
        error: String(e),
      }));
    }
  }, [onSuccess]);

  const reopenBrowser = useCallback(() => {
    if (state.loginUrl) {
      tauriSystem.openUrl(state.loginUrl).catch(() => {});
    }
  }, [state.loginUrl]);

  const close = useCallback(() => {
    // Cancel the in-flight flow by bumping the generation. Any pending
    // completeLogin resolution from this generation will be discarded
    // when it finally returns. The provider's subprocess / callback
    // listener will still run to completion on its own timeout.
    genRef.current += 1;
    setState({ open: false, phase: "idle", loginUrl: null, error: null });
  }, []);

  return { state, startAuth, reopenBrowser, close };
}
