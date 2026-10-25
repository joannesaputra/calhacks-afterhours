"use client";
import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FlaskConical, LogOut, Cpu, Mail, WifiOff } from "lucide-react";
import type { IntegrationStatus } from "@afterhours/contracts";
import { api, describeError } from "@/lib/api";
import { useIntegrations, useSession } from "@/lib/hooks";
import { formatDateTime } from "@/lib/format";
import { useGuard, useToast } from "./providers";
import { BrandMark } from "./brand";
import { ErrorPanel } from "./states";
import { SidebarNav } from "./sidebar-nav";

interface ShellState {
  demoEnabled: boolean;
  integrations: IntegrationStatus | undefined;
  /** False only when the API positively reports a stale worker. Unknown is treated as healthy. */
  workerHealthy: boolean;
}
const ShellContext = createContext<ShellState>({ demoEnabled: false, integrations: undefined, workerHealthy: true });
export const useShell = () => useContext(ShellContext);

const APP_NAME = "AfterHours";

export function ModeBadge({ integrations }: { integrations: IntegrationStatus | undefined }) {
  if (!integrations) return <span className="badge badge-neutral">Checking mode…</span>;
  const m = integrations.model;
  if (m.mode === "fixture") {
    return (
      <span className="badge badge-demo" title="Work is prepared by fixture intelligence, not a live model.">
        <FlaskConical size={14} aria-hidden />Fixture mode
      </span>
    );
  }
  if (!m.configured) {
    return (
      <span className="badge badge-warn" title="Live mode is selected but model credentials are missing on the server.">
        <AlertTriangle size={14} aria-hidden />Live model not configured
      </span>
    );
  }
  return (
    <span className="badge badge-outline" title="Work is prepared by a live model.">
      <Cpu size={14} aria-hidden />Live model{m.model ? ` · ${m.model}` : ""}
    </span>
  );
}

/** Browser connectivity. Display only: it never triggers work, and reconnecting simply lets the normal refresh run. */
function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export function AppShell({ demoEnabled, children }: { demoEnabled: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const toast = useToast();
  const guard = useGuard();
  const session = useSession();
  const online = useOnline();
  const authed = session.data?.authenticated === true;
  const integrationsQuery = useIntegrations(authed);

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      const here = window.location.pathname + window.location.search;
      router.replace(`/login?returnTo=${encodeURIComponent(here)}`);
    }
  }, [session.data, router]);

  if (session.isError) {
    return (
      <main className="center-page">
        <ErrorPanel error={session.error} title="Could not check your session" onRetry={() => void session.refetch()} />
      </main>
    );
  }
  if (!authed) {
    return (
      <main className="center-page" aria-busy="true">
        <p className="muted" role="status">{session.data ? "Redirecting to sign in…" : "Checking your session…"}</p>
      </main>
    );
  }

  const integrations = integrationsQuery.data;
  const workerHealthy = integrations ? integrations.worker.healthy : true;

  const guardedNav = (e: MouseEvent<HTMLAnchorElement>) => {
    if (guard.isDirty() && !window.confirm("You have unsaved changes. Leave without saving?")) e.preventDefault();
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch (e) {
      toast.push("error", describeError(e));
      return;
    }
    qc.clear();
    router.replace("/login");
  };

  return (
    <ShellContext.Provider value={{ demoEnabled, integrations, workerHealthy }}>
      <div className="shell">
        <aside className="rail">
          <div className="brand">
            <BrandMark />
            <span className="brand-name">{APP_NAME}</span>
            <span className="brand-sub">Work ready for review</span>
          </div>
          <nav aria-label="Main">
            <SidebarNav onNavigate={guardedNav} />
          </nav>
          <button type="button" className="nav-link nav-logout" onClick={logout}>
            <LogOut size={18} aria-hidden />
            <span>Sign out</span>
          </button>
        </aside>

        <div className="main-col">
          <header className="topbar">
            <div className="topbar-badges" aria-label="Current modes">
              <ModeBadge integrations={integrations} />
              {integrations && (
                <span className={`badge ${integrations.gmail.state === "connected" ? "badge-outline" : integrations.gmail.state === "error" ? "badge-warn" : "badge-neutral"}`}>
                  <Mail size={14} aria-hidden />
                  Gmail {integrations.gmail.state === "connected" ? "connected" : integrations.gmail.state === "error" ? "error" : "disconnected"}
                </span>
              )}
              {integrations && (
                <span className="badge badge-neutral">
                  Notifications: {integrations.notifications.channel === "outbox" ? "outbox (simulated)" : "WhatsApp"}
                </span>
              )}
            </div>
          </header>

          {!online && (
            <div className="banner banner-warn" role="status">
              <WifiOff size={18} aria-hidden />
              <div>
                <strong>You are offline.</strong> What you see may be out of date, and actions will fail until you are back online. Work on the server keeps running without this page.
              </div>
            </div>
          )}

          {integrations && !integrations.worker.healthy && (
            <div className="banner banner-warn" role="status">
              <AlertTriangle size={18} aria-hidden />
              <div>
                <strong>The worker is not running.</strong> Queued work will wait until it starts.
                {integrations.worker.lastHeartbeatAt
                  ? ` Last heartbeat: ${formatDateTime(integrations.worker.lastHeartbeatAt, undefined, true)}.`
                  : " It has not reported a heartbeat yet."}
              </div>
            </div>
          )}

          <main className="content" id="main">{children}</main>
        </div>
      </div>
    </ShellContext.Provider>
  );
}
