"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { IntegrationStatus } from "@afterhours/contracts";
import { api } from "../lib/api";
import { loginUrlFor, safeNext } from "../lib/next";
import { useResource } from "../lib/useResource";

export function Mark() {
  // Original AfterHours mark: a horizon line crossed by a rising slash. Not derived from any third-party logo.
  return (
    <svg viewBox="0 0 34 22" fill="none" aria-hidden>
      <path d="M2 17.5h30" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9 19 25 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 14.5 30 6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

function SystemStatus() {
  const { data } = useResource<IntegrationStatus>(() => api("/integrations"), 10000);
  if (!data) return null;
  const worker = data.worker.healthy;
  return (
    <div className="sys" title="Live status from the server">
      <span><span className={`dot ${worker ? "ok" : "bad"}`} /> Worker {worker ? "healthy" : "stale"}</span>
      <span><span className={`dot ${data.gmail.state === "connected" ? "ok" : ""}`} /> Gmail {data.gmail.state}</span>
      <span>{data.model.mode === "fixture" ? "Fixture mode" : "Live model"}</span>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const onLogin = path === "/login";

  useEffect(() => {
    let alive = true;
    api<{ authenticated: boolean }>("/session")
      .then((s) => {
        if (!alive) return;
        setAuthed(s.authenticated);
        if (!s.authenticated && !onLogin) router.replace(loginUrlFor(path, window.location.search));
        if (s.authenticated && onLogin) router.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
      })
      .catch(() => alive && setAuthed(false));
    return () => { alive = false; };
  }, [onLogin, router, path]);

  async function signOut() {
    await api("/session", { method: "DELETE" }).catch(() => undefined);
    setAuthed(false);
    router.replace("/login");
  }

  const show = onLogin || authed === true;
  return (
    <div className="frame">
      <header className="nav">
        <div className="nav-row">
          <Link href="/" className="brand"><Mark /><span>AfterHours</span></Link>
          {authed && (
            <nav className="nav-links" aria-label="Primary">
              <Link href="/" className="nav-link" aria-current={path === "/" || path.startsWith("/tasks") ? "page" : undefined}>Queue</Link>
              <Link href="/settings" className="nav-link" aria-current={path.startsWith("/settings") ? "page" : undefined}>Settings</Link>
            </nav>
          )}
          {!authed && <span style={{ flex: 1 }} />}
          <div className="nav-right">
            {authed && <SystemStatus />}
            {authed && <button className="btn btn-secondary btn-sm" onClick={signOut}>Sign out</button>}
          </div>
        </div>
      </header>
      <main className="main">{show ? children : null}</main>
      <footer className="footer">
        <div className="footer-row">
          <div>
            <div className="brand"><Mark /><span>AfterHours</span></div>
            <small>Prototype. Marking work reviewed records your acceptance; nothing is sent to anyone.</small>
          </div>
          <div className="fcols">
            <div className="fcol"><h5>Workspace</h5><Link href="/">Queue</Link><Link href="/settings">Settings</Link></div>
            <div className="fcol"><h5>Modes</h5><span>Demo email or Gmail</span><span>Fixture or live model</span><span>Outbox notifications</span></div>
          </div>
        </div>
      </footer>
    </div>
  );
}
