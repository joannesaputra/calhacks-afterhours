"use client";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Cpu, Link2, Loader2, Server } from "lucide-react";
import type { IntegrationStatus } from "@afterhours/contracts";
import { describeError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useDisconnectGmail } from "@/lib/hooks";
import { useToast } from "../providers";

export function GmailSection({ status, timeZone }: { status: IntegrationStatus["gmail"] | undefined; timeZone?: string }) {
  const disconnect = useDisconnectGmail();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = status?.state;
  return (
    <section className="card settings-section" aria-labelledby="gmail-h">
      <h2 id="gmail-h" className="h3">Gmail</h2>
      {!status && <p className="muted" role="status">Checking connection…</p>}
      {status && (
        <>
          <p>
            <span className={`badge ${state === "connected" ? "badge-good" : state === "error" ? "badge-warn" : "badge-neutral"}`}>
              {state === "connected" ? <CheckCircle2 size={14} aria-hidden /> : state === "error" ? <AlertTriangle size={14} aria-hidden /> : <Link2 size={14} aria-hidden />}
              {state === "connected" ? "Connected" : state === "error" ? "Connection error" : "Disconnected"}
            </span>
          </p>
          <dl className="kv">
            <dt>Account</dt><dd className="wrap-anywhere">{status.email ?? "—"}</dd>
            <dt>Connected</dt><dd>{formatDateTime(status.connectedAt, timeZone)}</dd>
            <dt>Last checked</dt><dd>{formatDateTime(status.lastPollAt, timeZone, true)}</dd>
          </dl>
          {status.lastError && <p className="callout callout-warn" role="note"><AlertTriangle size={16} aria-hidden /> {status.lastError}</p>}
          <p className="muted small">Google’s read-only permission covers the whole mailbox; it cannot send, change or delete mail. AfterHours reads only new inbox messages that arrive after connecting, checks each sender, and prepares work only for approved senders. Older mail is not imported unless you allow email history below.</p>
          <div className="actions">
            <a className="btn btn-secondary" href="/api/integrations/gmail/start">{state === "connected" ? "Reconnect Gmail" : "Connect Gmail"}</a>
            {state !== "disconnected" && !confirming && <button type="button" className="btn btn-ghost" onClick={() => setConfirming(true)}>Disconnect</button>}
            {confirming && (
              <span className="inline-confirm" role="group" aria-label="Confirm disconnect">
                <span className="small">Stop reading this inbox? Work already queued keeps running.</span>
                <button
                  type="button" className="btn btn-danger" disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(undefined, {
                    onSuccess: () => { toast.push("success", "Gmail disconnected."); setConfirming(false); },
                    onError: (e) => setError(describeError(e)),
                  })}
                >
                  {disconnect.isPending ? <><Loader2 size={16} className="spin" aria-hidden />Disconnecting…</> : "Yes, disconnect"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
              </span>
            )}
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}

export function ModelAndWorkerSection({ status, timeZone }: { status: IntegrationStatus | undefined; timeZone?: string }) {
  return (
    <section className="card settings-section" aria-labelledby="model-h">
      <h2 id="model-h" className="h3">Model and worker</h2>
      {!status && <p className="muted" role="status">Checking status…</p>}
      {status && (
        <>
          <h3 className="h4"><Cpu size={16} aria-hidden /> Generation</h3>
          <dl className="kv">
            <dt>Mode</dt><dd>{status.model.mode === "fixture" ? "Fixture intelligence (no live model)" : "Live model"}</dd>
            <dt>Provider</dt><dd>{status.model.provider}</dd>
            <dt>Model</dt><dd>{status.model.model ?? "—"}</dd>
            <dt>Configured</dt>
            <dd>{status.model.mode === "fixture" ? "Not needed in fixture mode" : status.model.configured ? "Yes" : <span className="bad"><AlertTriangle size={14} aria-hidden /> No: model credentials are missing on the server, so live tasks will fail.</span>}</dd>
          </dl>
          <p className="muted small">The model and its API key are set in the server environment and cannot be changed from the browser.</p>
          <h3 className="h4"><Server size={16} aria-hidden /> Worker</h3>
          <p>
            <span className={`badge ${status.worker.healthy ? "badge-good" : "badge-warn"}`}>
              {status.worker.healthy ? <CheckCircle2 size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}
              {status.worker.healthy ? "Healthy" : "Stale or stopped"}
            </span>
          </p>
          <p className="muted small">Last heartbeat: {formatDateTime(status.worker.lastHeartbeatAt, timeZone, true)}.{!status.worker.healthy && " Queued work waits until the worker is running."}</p>
        </>
      )}
    </section>
  );
}
