import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useConnections,
  useConnectedToolkits,
  useResetConnections,
} from "../../hooks/queries";
import { tauriConnections, tauriSystem } from "../../lib/tauri";
import { getEngine } from "../../lib/engine";
import { useComposioAuth } from "../../hooks/use-composio-auth";
import { useIntegrationsAuth } from "../../hooks/use-integrations-auth";
import { useActiveIntegrationsProvider } from "../../hooks/use-integrations-provider";
import { queryKeys } from "../../lib/query-keys";
import { ComposioAuthDialog } from "../composio-auth-dialog";
import { IntegrationsProviderBadge } from "../integrations/provider-picker";
import { BrowseAppsSection } from "./browse-apps-section";
import { ConnectedAppsSection } from "./connected-apps-section";
import {
  LoadingState,
  NotInstalledState,
  NeedsAuthState,
  ErrorState,
} from "./integrations-states";

const COMPOSIO_DASHBOARD_URL = "https://dashboard.composio.dev";
const MERGE_DASHBOARD_URL = "https://app.merge.dev/";

interface IntegrationsViewProps {
  title?: string;
}

/**
 * The integrations panel renders against the currently-active provider.
 *
 * For Composio (default + bundled CLI) we keep using the legacy /v1/composio/*
 * routes and the rich app browsing UI built around them. The path is
 * well-tested and Composio's catalog is huge.
 *
 * For Merge we route through the new /v1/integrations/* surface end-to-end —
 * status, sign-in, app catalog, app connect. No bundled CLI; pure OAuth +
 * MCP from the engine.
 *
 * The provider picker (top-right badge) swaps the entire panel without a
 * page reload because both branches read the active provider from the same
 * query and re-render on switch.
 */
export function IntegrationsView({ title }: IntegrationsViewProps) {
  const { data: activeProvider } = useActiveIntegrationsProvider();
  const isMerge = activeProvider?.id === "merge";

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto w-full px-6 py-6">
        {title && (
          <div className="flex items-baseline justify-between mb-6 gap-3">
            <h1 className="text-[28px] font-normal text-foreground">{title}</h1>
            <IntegrationsProviderBadge />
          </div>
        )}
        {!title && (
          <div className="flex justify-end mb-4">
            <IntegrationsProviderBadge />
          </div>
        )}

        {isMerge ? <MergePanel /> : <ComposioPanel />}
      </div>
    </div>
  );
}

// ─── Composio branch ──────────────────────────────────────────────────

function ComposioPanel() {
  const { data: result, isLoading: loading, refetch } = useConnections();
  const reset = useResetConnections();
  const auth = useComposioAuth(() => reset());
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const isSignedIn = result?.status === "ok";
  const { data: connectedList } = useConnectedToolkits(isSignedIn);
  const connectedSet = useMemo(
    () => new Set(connectedList ?? []),
    [connectedList],
  );

  const handleManage = useCallback(() => {
    tauriSystem.openUrl(COMPOSIO_DASHBOARD_URL);
  }, []);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    setInstallError(null);
    try {
      await tauriConnections.installCli();
      await reset();
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setInstalling(false);
    }
  }, [reset]);

  return (
    <>
      {loading && <LoadingState />}
      {!loading && result?.status === "not_installed" && (
        <NotInstalledState onInstall={handleInstall} installing={installing} />
      )}
      {!loading && result?.status === "needs_auth" && (
        <NeedsAuthState onAuth={auth.startAuth} />
      )}
      {!loading && result?.status === "error" && (
        <ErrorState
          message={result.message}
          onRetry={() => refetch()}
          onReconnect={handleManage}
        />
      )}
      {installError && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-4">
          {installError}
        </p>
      )}
      {!loading && result?.status === "ok" && (
        <>
          <ConnectedAppsSection connectedToolkits={connectedSet} />
          <BrowseAppsSection connectedToolkits={connectedSet} />
        </>
      )}
      <ComposioAuthDialog
        state={auth.state}
        onClose={auth.close}
        onReopenBrowser={auth.reopenBrowser}
      />
    </>
  );
}

// ─── Merge branch ─────────────────────────────────────────────────────

/**
 * Routes everything through /v1/integrations/* — works the same for any
 * provider the engine elects, but is currently only mounted for Merge
 * because Composio has its own (well-tested) Composio-specific UI above.
 */
function MergePanel() {
  const qc = useQueryClient();
  const invalidate = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.integrationsStatus() }),
      qc.invalidateQueries({ queryKey: queryKeys.integrationsApps() }),
    ]);
  }, [qc]);
  const auth = useIntegrationsAuth(invalidate);
  const {
    data: status,
    isLoading: loading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.integrationsStatus(),
    queryFn: () => getEngine().integrationsStatus(),
    refetchOnWindowFocus: false,
  });
  const isSignedIn = status?.status === "ok";

  const handleManage = useCallback(() => {
    tauriSystem.openUrl(MERGE_DASHBOARD_URL);
  }, []);

  return (
    <>
      {loading && <LoadingState />}
      {!loading && status?.status === "needs_auth" && (
        <NeedsAuthState onAuth={auth.startAuth} />
      )}
      {!loading && status?.status === "error" && (
        <ErrorState
          message={status.message}
          onRetry={() => refetch()}
          onReconnect={handleManage}
        />
      )}
      {/* For Merge: NotInstalled cannot happen (no binary to install) but
          render the same install card if the engine returns it just in
          case future providers behave differently. */}
      {!loading && status?.status === "not_installed" && (
        <NotInstalledState
          onInstall={async () => {
            await refetch();
          }}
          installing={false}
        />
      )}
      {!loading && isSignedIn && <MergeSignedInBody onManage={handleManage} />}
      <ComposioAuthDialog
        state={auth.state}
        onClose={auth.close}
        onReopenBrowser={auth.reopenBrowser}
      />
    </>
  );
}

function MergeSignedInBody({ onManage }: { onManage: () => void }) {
  const { t } = useTranslation("integrations");
  const { data: apps, isLoading } = useQuery({
    queryKey: queryKeys.integrationsApps(),
    queryFn: () => getEngine().integrationsListApps(),
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
  });

  const connected = useMemo(
    () => (apps ?? []).filter((a) => a.connected),
    [apps],
  );

  return (
    <div className="space-y-6 mt-4">
      <div className="rounded-xl border border-border bg-secondary/30 p-4">
        <h2 className="text-sm font-semibold text-foreground mb-1">
          {t("merge.signedInTitle")}
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("merge.signedInBody")}
        </p>
        <button
          onClick={onManage}
          className="mt-3 inline-flex items-center gap-1 h-7 px-3 rounded-full border border-border bg-background text-foreground text-xs font-medium hover:bg-secondary transition-colors duration-200"
        >
          {t("merge.openDashboard")}
        </button>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">
          {t("merge.connectedHeading", { count: connected.length })}
        </h2>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">{t("merge.loading")}</p>
        ) : connected.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("merge.noConnections")}
          </p>
        ) : (
          <ul className="space-y-2">
            {connected.map((app) => (
              <li
                key={app.slug}
                className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
              >
                <img
                  src={app.logo_url}
                  alt=""
                  className="size-6 rounded"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility =
                      "hidden";
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {app.display_name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {app.description}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
