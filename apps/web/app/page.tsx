"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IntegrationStatus, TaskSummary } from "@afterhours/contracts";
import { ACTIVE, ApiError, api, when } from "./lib/api";
import { useResource } from "./lib/useResource";
import { Badge, Notice, RotatingWord, StatusPill } from "./components/ui";

type TaskPage = { items: TaskSummary[]; nextCursor: string | null };

function TaskCard({ t }: { t: TaskSummary }) {
  return (
    <Link href={`/tasks/${t.id}`} className="card card-link">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <StatusPill status={t.status} />
        <span className="eyebrow">{when(t.createdAt)}</span>
      </div>
      <h3 className="card-title" style={{ marginTop: 18, fontSize: 18, lineHeight: "24px" }}>{t.title}</h3>
      <div className="card-meta">{t.senderName ? `${t.senderName} · ` : ""}{t.senderEmail}</div>
      <div className="tags" style={{ marginTop: 14 }}>
        <span className="tag solid">{t.ingestionMode === "demo" ? "Demo email" : "Gmail"}</span>
        <span className="tag solid">{t.generationMode === "fixture" ? "Fixture intelligence" : "Live model"}</span>
        {t.revision > 1 && <span className="tag">Revision {t.revision}</span>}
        {t.artifactCount > 0 && <span className="tag">{t.artifactCount} files</span>}
        {t.warningCount > 0 && <span className="tag">{t.warningCount} warnings</span>}
      </div>
      {t.error && <div className="card-meta" style={{ color: "var(--red)", marginTop: 12 }}>{t.error.message}</div>}
      <div className="card-foot"><span>{t.status === "ready" ? "Review" : "Open"}</span><span className="go">Explore →</span></div>
    </Link>
  );
}

function Group({ title, items, hint }: { title: string; items: TaskSummary[]; hint?: string }) {
  if (items.length === 0) return null;
  return (
    <section className="section">
      <div className="section-head">
        <div><div className="eyebrow">{hint ?? "Queue"}</div><h2 className="h3" style={{ marginTop: 6 }}>{title}</h2></div>
        <span className="eyebrow">{items.length} {items.length === 1 ? "task" : "tasks"}</span>
      </div>
      <div className="grid grid-3">{items.map((t) => <TaskCard key={t.id} t={t} />)}</div>
    </section>
  );
}

export default function Queue() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "bad" | "ok"; text: string } | null>(null);
  const [active, setActive] = useState(false);
  const tasks = useResource<TaskPage>(async () => {
    const page = await api<TaskPage>("/tasks?limit=100");
    setActive(page.items.some((t) => ACTIVE.has(t.status)));
    return page;
  }, active ? 2000 : 8000);
  const integ = useResource<IntegrationStatus>(() => api("/integrations"), 15000);

  async function inject(scenario: "proposal" | "report" | "ambiguous" | "no_action") {
    setBusy(scenario);
    setNotice(null);
    try {
      const r = await api<{ taskId: string }>("/demo/inject", { method: "POST", body: { scenario } });
      router.push(`/tasks/${r.taskId}`);
    } catch (e) {
      setNotice({ tone: "bad", text: e instanceof ApiError && e.status === 404 ? "Demo injection is disabled on this server (DEMO_ENABLED)." : e instanceof Error ? e.message : "Could not queue the demo." });
      setBusy(null);
    }
  }

  const items = tasks.data?.items ?? [];
  const by = (...s: string[]) => items.filter((t) => s.includes(t.status));
  const ready = by("ready"), working = by("queued", "planning", "running"), input = by("needs_input"), failed = by("failed");
  const done = by("approved", "dismissed", "skipped");
  const mode = integ.data?.model.mode;

  return (
    <div className="inner">
      <section className="hero">
        <Badge chip={mode === "live" ? "Live" : "Fixture"}>
          {integ.data ? (integ.data.gmail.state === "connected" ? "Watching your connected inbox" : "Gmail not connected · demo emails only") : "Checking status…"}
        </Badge>
        <h1 className="h1">Client requests, turned into files you can <RotatingWord words={["review", "refine", "present"]} />.</h1>
        <p className="lede">An authorized email arrives. AfterHours reads it, prepares a real proposal, report or deck, and waits in your queue. Marking reviewed never sends anything.</p>
        <div className="cta-row">
          <button className="btn btn-primary" disabled={busy !== null} onClick={() => inject("proposal")}>
            {busy === "proposal" ? <span className="spin" /> : "Run demo proposal"}
          </button>
          <button className="btn btn-secondary" disabled={busy !== null} onClick={() => inject("report")}>
            {busy === "report" ? <span className="spin" /> : "Run demo report"}
          </button>
        </div>
        <div className="cta-row" style={{ marginTop: 14 }}>
          <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => inject("ambiguous")}>Demo: unclear request</button>
          <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => inject("no_action")}>Demo: no action needed</button>
        </div>
        <p className="help" style={{ marginTop: 16 }}>Demo buttons inject a labeled fictional email through the same path as Gmail.</p>
        {notice && <div style={{ maxWidth: 520, margin: "16px auto 0", textAlign: "left" }}><Notice tone={notice.tone}>{notice.text}</Notice></div>}
      </section>

      <div className="stats" aria-label="Queue summary">
        <div className="stat"><div className="n">{ready.length}</div><div className="l">Ready to review</div></div>
        <div className="stat"><div className="n">{working.length}</div><div className="l">In progress</div></div>
        <div className="stat"><div className="n">{input.length}</div><div className="l">Need your input</div></div>
        <div className="stat"><div className="n">{done.length}</div><div className="l">Reviewed, dismissed or skipped</div></div>
      </div>

      {integ.data && !integ.data.worker.healthy && (
        <div style={{ marginTop: 28 }}><Notice tone="warn"><b>Worker not responding.</b> Tasks will wait in the queue until the worker is running (<span className="mono">pnpm dev:worker</span>).</Notice></div>
      )}
      {tasks.error && <div style={{ marginTop: 28 }}><Notice tone="bad">Could not load tasks: {tasks.error.message}</Notice></div>}
      {tasks.loading && !tasks.data && <div className="grid grid-3" style={{ marginTop: 40 }}><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>}
      {tasks.data && items.length === 0 && (
        <div className="empty" style={{ marginTop: 40 }}>Nothing here yet. Run a demo above, or connect Gmail in Settings and have an allowed sender email you a request.</div>
      )}

      <Group title="Ready to review" items={ready} hint="Prepared for you" />
      <Group title="In progress" items={working} hint="Working now" />
      <Group title="Needs your input" items={input} hint="Waiting on answers" />
      <Group title="Failed" items={failed} hint="Needs attention" />
      <Group title="Earlier" items={done} hint="History" />
    </div>
  );
}
