"use client";
import { useEffect, useState } from "react";
import type { IntegrationStatus, WorkspaceSettings } from "@afterhours/contracts";
import { ApiError, api, when } from "../lib/api";
import { useResource } from "../lib/useResource";
import { Notice } from "../components/ui";

const GMAIL_MESSAGES: Record<string, string> = {
  connected: "Gmail connected.",
  invalid_state: "The connection attempt could not be verified. Start again.",
  expired: "The connection attempt expired. Start again.",
  session: "Sign in again, then reconnect Gmail.",
  denied: "Google access was not granted.",
  no_refresh_token: "Google did not return a refresh token. Remove the app's access in your Google account and reconnect.",
  exchange_failed: "Google rejected the connection. Check the OAuth client settings.",
};

function Stat({ n, l, tone }: { n: string; l: string; tone?: "ok" | "bad" | "warn" | "" }) {
  return <div className="stat"><div className="n" style={{ fontSize: 28, lineHeight: "34px", color: tone === "bad" ? "var(--red)" : tone === "ok" ? "var(--green)" : undefined }}>{n}</div><div className="l">{l}</div></div>;
}

export default function Settings() {
  const integ = useResource<IntegrationStatus>(() => api("/integrations"), 10000);
  const settings = useResource<WorkspaceSettings>(() => api("/settings"), null);
  const [form, setForm] = useState<WorkspaceSettings | null>(null);
  const [senders, setSenders] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [gmail, setGmail] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    if (settings.data) { setForm(settings.data); setSenders(settings.data.allowedSenders.join("\n")); }
  }, [settings.data]);
  useEffect(() => {
    const g = new URLSearchParams(window.location.search);
    const status = g.get("gmail");
    if (status === "connected") setGmail({ tone: "ok", text: GMAIL_MESSAGES.connected! });
    else if (status === "error") setGmail({ tone: "bad", text: GMAIL_MESSAGES[g.get("reason") ?? ""] ?? "Gmail connection failed." });
  }, []);

  async function save() {
    if (!form) return;
    setBusy("save"); setMsg(null);
    try {
      const saved = await api<WorkspaceSettings>("/settings", {
        method: "PATCH",
        body: {
          automationEnabled: form.automationEnabled,
          autoPrepare: form.autoPrepare,
          allowedSenders: senders.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          notifications: {
            channel: form.notifications.channel,
            recipient: form.notifications.recipient === "" ? null : form.notifications.recipient,
            quietHours: form.notifications.quietHours,
            digestTime: form.notifications.digestTime,
          },
        },
      });
      setForm(saved); setSenders(saved.allowedSenders.join("\n"));
      setMsg({ tone: "ok", text: "Settings saved." });
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof ApiError ? e.message : "Could not save." });
    } finally { setBusy(null); }
  }

  async function disconnect() {
    setBusy("disconnect");
    try { await api("/integrations/gmail", { method: "DELETE" }); setGmail({ tone: "ok", text: "Gmail disconnected." }); await integ.refresh(); }
    catch (e) { setGmail({ tone: "bad", text: e instanceof Error ? e.message : "Could not disconnect." }); }
    finally { setBusy(null); }
  }

  const i = integ.data;
  const n = form?.notifications;
  return (
    <div className="inner" style={{ paddingBottom: 80 }}>
      <section className="hero" style={{ textAlign: "left", paddingBottom: 32 }}>
        <div className="eyebrow">Workspace</div>
        <h1 className="h1" style={{ margin: "12px 0 12px", fontSize: "clamp(34px,5vw,52px)" }}>Settings and connections</h1>
        <p className="lede" style={{ margin: 0 }}>What is connected, who may trigger work, and when notifications are allowed.</p>
      </section>

      {i && (
        <div className="stats" style={{ marginBottom: 40 }}>
          <Stat n={i.worker.healthy ? "Healthy" : "Stale"} l={`Worker${i.worker.lastHeartbeatAt ? ` · last seen ${when(i.worker.lastHeartbeatAt)}` : " · never seen"}`} tone={i.worker.healthy ? "ok" : "bad"} />
          <Stat n={i.gmail.state === "connected" ? "Connected" : i.gmail.state === "error" ? "Error" : "Disconnected"} l={i.gmail.email ?? "Gmail"} tone={i.gmail.state === "connected" ? "ok" : i.gmail.state === "error" ? "bad" : ""} />
          <Stat n={i.model.mode === "fixture" ? "Fixture" : "Live"} l={i.model.mode === "fixture" ? "Fixture intelligence (no model call)" : `${i.model.provider}${i.model.configured ? "" : " · not configured"}`} tone={i.model.mode === "live" && !i.model.configured ? "bad" : ""} />
          <Stat n={i.notifications.channel === "outbox" ? "Outbox" : "WhatsApp"} l={i.notifications.channel === "outbox" ? "Simulated, not sent to a phone" : i.notifications.eligible ? "Eligible" : "Not eligible"} />
        </div>
      )}

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <section className="card card-lg">
          <div className="eyebrow">Inbox</div>
          <h2 className="h3" style={{ margin: "6px 0 16px" }}>Gmail</h2>
          {gmail && <div style={{ marginBottom: 16 }}><Notice tone={gmail.tone}>{gmail.text}</Notice></div>}
          {i?.gmail.state === "connected" ? (
            <div className="stack">
              <p className="muted" style={{ margin: 0 }}>Connected as <b style={{ color: "#fff", fontWeight: 500 }}>{i.gmail.email}</b> since {i.gmail.connectedAt ? when(i.gmail.connectedAt) : "—"}. Read-only access. Only new mail from allowed senders is processed.</p>
              <p className="help" style={{ margin: 0 }}>{i.gmail.lastPollAt ? `Last checked ${when(i.gmail.lastPollAt)}.` : "Not checked yet."}</p>
              <div><button className="btn btn-secondary" disabled={busy !== null} onClick={disconnect}>{busy === "disconnect" ? <span className="spin" /> : "Disconnect"}</button></div>
            </div>
          ) : (
            <div className="stack">
              {i?.gmail.state === "error" && i.gmail.lastError && <Notice tone="bad">{i.gmail.lastError}</Notice>}
              <p className="muted" style={{ margin: 0 }}>Not connected. Demo emails still work. Connecting needs a Google test client configured on the server (see the runbook), and asks for read-only Gmail access.</p>
              <div><a className="btn btn-primary" href="/api/integrations/gmail/start">Connect Gmail</a></div>
            </div>
          )}
        </section>

        <section className="card card-lg">
          <div className="eyebrow">Automation</div>
          <h2 className="h3" style={{ margin: "6px 0 16px" }}>Who can trigger work</h2>
          {!form ? <div className="skeleton" style={{ height: 120 }} /> : (
            <>
              <div className="switch"><div><div>Automation enabled</div><div className="help">Process new inbox mail from allowed senders.</div></div>
                <input className="toggle" type="checkbox" checked={form.automationEnabled} onChange={(e) => setForm({ ...form, automationEnabled: e.target.checked })} aria-label="Automation enabled" /></div>
              <div className="switch"><div><div>Prepare automatically</div><div className="help">Start work without asking first.</div></div>
                <input className="toggle" type="checkbox" checked={form.autoPrepare} onChange={(e) => setForm({ ...form, autoPrepare: e.target.checked })} aria-label="Prepare automatically" /></div>
              <div className="field" style={{ marginTop: 18 }}>
                <label htmlFor="senders">Allowed senders</label>
                <textarea id="senders" className="textarea" value={senders} onChange={(e) => setSenders(e.target.value)} placeholder="client@example.com" />
                <span className="help">Exact addresses, one per line. No wildcards. Mail from anyone else is ignored and never reaches a model.</span>
              </div>
            </>
          )}
        </section>
      </div>

      {form && n && (
        <section className="card card-lg" style={{ marginTop: 16 }}>
          <div className="eyebrow">Notifications</div>
          <h2 className="h3" style={{ margin: "6px 0 20px" }}>Delivery and quiet hours</h2>
          {i && i.notifications.channel === "whatsapp" && !i.notifications.eligible && <div style={{ marginBottom: 16 }}><Notice tone="warn">WhatsApp is selected but live sending is blocked (the server operator has not confirmed eligibility). Results stay available here.</Notice></div>}
          <div className="grid grid-2" style={{ gap: 24 }}>
            <div>
              <div className="field"><label htmlFor="ch">Channel</label>
                <select id="ch" className="select" value={n.channel} onChange={(e) => setForm({ ...form, notifications: { ...n, channel: e.target.value as "outbox" | "whatsapp" } })}>
                  <option value="outbox">Outbox (simulated)</option><option value="whatsapp">WhatsApp (if eligible)</option>
                </select></div>
              <div className="field"><label htmlFor="rc">Recipient</label>
                <input id="rc" className="input" value={n.recipient ?? ""} onChange={(e) => setForm({ ...form, notifications: { ...n, recipient: e.target.value } })} placeholder="Only needed for WhatsApp" />
                <span className="help">Provider credentials are server settings and cannot be edited here.</span></div>
              <div className="field"><label htmlFor="dg">Morning digest time</label>
                <input id="dg" className="input" type="time" value={n.digestTime} onChange={(e) => setForm({ ...form, notifications: { ...n, digestTime: e.target.value } })} /></div>
            </div>
            <div>
              <div className="switch" style={{ borderTop: 0, paddingTop: 0 }}><div><div>Quiet hours</div><div className="help">Work continues; only messages wait for the digest.</div></div>
                <input className="toggle" type="checkbox" checked={n.quietHours.enabled} onChange={(e) => setForm({ ...form, notifications: { ...n, quietHours: { ...n.quietHours, enabled: e.target.checked } } })} aria-label="Quiet hours" /></div>
              <div className="grid grid-2" style={{ gap: 12, marginTop: 8 }}>
                <div className="field"><label htmlFor="qs">From</label><input id="qs" className="input" type="time" value={n.quietHours.start} onChange={(e) => setForm({ ...form, notifications: { ...n, quietHours: { ...n.quietHours, start: e.target.value } } })} /></div>
                <div className="field"><label htmlFor="qe">Until</label><input id="qe" className="input" type="time" value={n.quietHours.end} onChange={(e) => setForm({ ...form, notifications: { ...n, quietHours: { ...n.quietHours, end: e.target.value } } })} /></div>
              </div>
              <div className="field"><label htmlFor="tz">Timezone</label><input id="tz" className="input" value={n.quietHours.timezone} onChange={(e) => setForm({ ...form, notifications: { ...n, quietHours: { ...n.quietHours, timezone: e.target.value } } })} /><span className="help">IANA name, e.g. America/Los_Angeles.</span></div>
            </div>
          </div>
        </section>
      )}

      {form && (
        <div className="row" style={{ marginTop: 24 }}>
          <button className="btn btn-primary" disabled={busy !== null} onClick={save}>{busy === "save" ? <span className="spin" /> : "Save changes"}</button>
          {msg && <div style={{ flex: 1, minWidth: 240 }}><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        </div>
      )}
      {(integ.error || settings.error) && <div style={{ marginTop: 24 }}><Notice tone="bad">Could not load settings: {(integ.error ?? settings.error)?.message}</Notice></div>}
    </div>
  );
}
