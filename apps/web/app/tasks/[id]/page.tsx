"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { ContentBlock, TaskDetail, WorkProduct } from "@afterhours/contracts";
import { ACTIVE, ApiError, api, bytes, when } from "../../lib/api";
import { useResource } from "../../lib/useResource";
import { Notice, StatusPill, Term } from "../../components/ui";

function Refs({ block }: { block: ContentBlock }) {
  if (block.evidence.length === 0) return <div className="basis">{block.basis}</div>;
  return (
    <div className="refs">
      <span className="basis" style={{ alignSelf: "center" }}>{block.basis}</span>
      {block.evidence.map((e, i) => (
        <span key={i} className="ref" title={[e.locator, e.quote].filter(Boolean).join(" — ")}>{e.sourceId}{e.locator ? ` · ${e.locator}` : ""}</span>
      ))}
    </div>
  );
}

function Block({ b }: { b: ContentBlock }) {
  return (
    <div>
      {b.heading && <h4>{b.heading}</h4>}
      {b.kind === "paragraph" && b.text && <p>{b.text}</p>}
      {b.kind === "bullets" && <ul>{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {b.kind === "table" && (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr>{b.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {b.kind === "chart" && b.chart && (() => {
        const max = Math.max(1, ...b.chart.series.flatMap((s) => s.values));
        return (
          <div className="bars">
            {b.chart.series.map((s) => (
              <div key={s.name}>
                {b.chart!.series.length > 1 && <div className="eyebrow" style={{ margin: "6px 0 4px" }}>{s.name}</div>}
                {b.chart!.labels.map((l, i) => {
                  const v = s.values[i] ?? 0;
                  return (
                    <div key={l} className="bar-row">
                      <span className="muted">{l}</span>
                      <div className="bar-track"><div className="bar" style={{ width: `${(v / max) * 100}%` }} /></div>
                      <span className="mono">{v.toLocaleString()}{b.chart!.unit ? ` ${b.chart!.unit}` : ""}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })()}
      <Refs block={b} />
    </div>
  );
}

function Product({ p }: { p: WorkProduct }) {
  return (
    <div className="preview">
      <div className="eyebrow">{p.kind}</div>
      <h3 className="h3" style={{ margin: "4px 0 4px" }}>{p.title}</h3>
      {p.subtitle && <p className="muted" style={{ margin: "0 0 24px" }}>{p.subtitle}</p>}
      {p.blocks.map((b) => <Block key={b.id} b={b} />)}
      {p.slides.map((s, i) => (
        <div key={s.id} className="slide">
          <div className="n">Slide {i + 1} · {s.layout.replace("_", " ")}</div>
          <h4 style={{ margin: "0 0 10px" }}>{s.title}</h4>
          {s.blocks.map((b) => <Block key={b.id} b={b} />)}
          {s.speakerNotes && <p className="help" style={{ marginTop: 8 }}>Speaker notes: {s.speakerNotes}</p>}
        </div>
      ))}
      {p.assumptions.length > 0 && <><h4>Assumptions and unknowns</h4><ul>{p.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
      {p.warnings.length > 0 && <><h4>Warnings</h4><ul>{p.warnings.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
    </div>
  );
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const [active, setActive] = useState(true);
  const [msg, setMsg] = useState<{ tone: "bad" | "ok" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [tab, setTab] = useState(0);
  const res = useResource<TaskDetail>(async () => {
    const d = await api<TaskDetail>(`/tasks/${id}`);
    setActive(ACTIVE.has(d.task.status));
    return d;
  }, active ? 2000 : null, [id]);

  const d = res.data;

  async function act<T>(key: string, fn: () => Promise<T>, okText?: string) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      if (okText) setMsg({ tone: "ok", text: okText });
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_REVISION") setMsg({ tone: "warn", text: "This task changed since you loaded it. The page has been refreshed; check the latest revision and try again." });
      else setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(null);
      await res.refresh();
    }
  }

  if (res.error && !d) {
    const notFound = res.error instanceof ApiError && res.error.status === 404;
    return <div className="inner" style={{ padding: "64px 0" }}><Notice tone="bad">{notFound ? "That task does not exist." : `Could not load the task: ${res.error.message}`}</Notice><p><Link className="btn btn-secondary btn-sm" href="/">Back to queue</Link></p></div>;
  }
  if (!d) return <div className="inner" style={{ padding: "64px 0" }}><div className="skeleton" /></div>;

  const t = d.task;
  const rev = t.revision;
  const required = d.questions.filter((q) => q.required);
  const canSubmit = required.every((q) => (answers[q.id] ?? "").trim() !== "");
  const files = d.artifacts;
  const current = d.products[Math.min(tab, Math.max(0, d.products.length - 1))];

  return (
    <div className="inner">
      <div style={{ paddingTop: 40 }}>
        <Link href="/" className="eyebrow">← Queue</Link>
      </div>
      <div className="detail">
        <div className="stack" style={{ gap: 40, minWidth: 0 }}>
          <div>
            <div className="row" style={{ marginBottom: 14 }}>
              <StatusPill status={t.status} />
              <span className="tag solid">{t.ingestionMode === "demo" ? "Demo email" : "Gmail"}</span>
              <span className="tag solid">{t.generationMode === "fixture" ? "Fixture intelligence" : "Live model"}</span>
              <span className="tag">Revision {rev}</span>
              {ACTIVE.has(t.status) && <span className="row eyebrow"><span className="spin" /> Updating live</span>}
            </div>
            <h1 className="h2" style={{ fontSize: "clamp(28px,4vw,44px)", lineHeight: 1.1 }}>{t.title}</h1>
            <p className="muted" style={{ marginTop: 12 }}>
              From {t.senderName ? `${t.senderName} · ` : ""}{t.senderEmail}. Ingested {when(t.createdAt)}. Email dated {when(d.email.receivedAt)}.
            </p>
          </div>

          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {t.status === "failed" && t.error && (
            <Notice tone="bad"><b>{t.error.code}</b><br />{t.error.message}{t.error.retryable ? " This may be temporary." : ""}</Notice>
          )}
          {t.status === "skipped" && <Notice>This email did not contain a request AfterHours supports, so no files were made.</Notice>}
          {d.task.warningCount > 0 && <Notice tone="warn">{t.warningCount} warning{t.warningCount === 1 ? "" : "s"} recorded. See the activity log below.</Notice>}

          {t.status === "needs_input" && (
            <section className="card card-lg">
              <div className="eyebrow">AfterHours needs a few facts before it can write this</div>
              <h2 className="h3" style={{ margin: "8px 0 24px" }}>Your input</h2>
              {d.questions.map((q) => (
                <div className="field" key={q.id}>
                  <label htmlFor={`q-${q.id}`}>{q.question}{q.required ? "" : " (optional)"}</label>
                  <textarea id={`q-${q.id}`} className="textarea" value={answers[q.id] ?? ""} maxLength={5000}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
                  <span className="help">{q.reason}</span>
                </div>
              ))}
              <div className="row">
                <button className="btn btn-primary" disabled={!canSubmit || busy !== null}
                  onClick={() => act("answers", () => api(`/tasks/${id}/answers`, { method: "POST", body: { revision: rev, answers: d.questions.map((q) => ({ questionId: q.id, answer: answers[q.id] ?? "" })).filter((a) => a.answer.trim() !== "" || required.some((r) => r.id === a.questionId)) } }), "Answers saved. A new revision is queued.")}>
                  {busy === "answers" ? <span className="spin" /> : "Submit answers"}
                </button>
                <span className="help">Your answers are treated as facts for the document, never as instructions to send or change anything.</span>
              </div>
            </section>
          )}

          <section>
            <div className="eyebrow">Incoming request</div>
            <h2 className="h3" style={{ margin: "6px 0 16px" }}>{d.email.subject}</h2>
            <div className="card">
              <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#d4d4d4" }}>{d.email.bodyText}</p>
              {d.email.attachments.length > 0 && (
                <div className="tags" style={{ marginTop: 18 }}>
                  {d.email.attachments.map((a) => <span key={a.id} className="tag">{a.filename} · {bytes(a.sizeBytes)}</span>)}
                </div>
              )}
            </div>
          </section>

          {d.plan && (
            <section>
              <div className="eyebrow">Plan</div>
              <h2 className="h3" style={{ margin: "6px 0 16px" }}>{d.plan.title}</h2>
              <div className="card">
                <p style={{ margin: "0 0 12px", color: "#d4d4d4" }}>{d.plan.requestSummary}</p>
                {d.plan.dueAt && <p className="muted" style={{ margin: "0 0 12px" }}>Due {when(d.plan.dueAt)}{d.plan.dueAtExplanation ? ` — ${d.plan.dueAtExplanation}` : ""}</p>}
                <ul style={{ margin: 0, paddingLeft: 20, color: "#d4d4d4" }}>{d.plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
                {d.plan.assumptions.length > 0 && <><div className="label" style={{ marginTop: 18 }}>Assumptions</div><ul style={{ margin: "6px 0 0", paddingLeft: 20, color: "#d4d4d4" }}>{d.plan.assumptions.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
              </div>
            </section>
          )}

          <section>
            <div className="eyebrow">Activity</div>
            <h2 className="h3" style={{ margin: "6px 0 16px" }}>Progress log</h2>
            <Term title={`task/${t.id.slice(0, 8)} · ${t.status}`}>
              {d.events.map((e) => (
                <div key={e.id} className={`term-line ${e.type}`}>
                  <time>{new Date(e.createdAt).toLocaleTimeString(undefined, { hour12: false })}</time>
                  <span className="stage">{e.stage}</span>
                  <span className="rev">r{e.revision}</span>
                  <span>{e.message}</span>
                </div>
              ))}
            </Term>
          </section>

          {d.products.length > 0 && current && (
            <section>
              <div className="section-head" style={{ marginBottom: 16 }}>
                <div><div className="eyebrow">Content preview — structured from the same content used to build the files, not a pixel-exact render</div><h2 className="h3" style={{ marginTop: 6 }}>What is in the files</h2></div>
                <div className="tabs" role="tablist">
                  {d.products.map((p, i) => <button key={p.id} role="tab" aria-selected={i === tab} className="tab" onClick={() => setTab(i)}>{p.kind}</button>)}
                </div>
              </div>
              <Product p={current} />
            </section>
          )}

          {d.sources.length > 0 && (
            <section>
              <div className="eyebrow">Sources</div>
              <h2 className="h3" style={{ margin: "6px 0 16px" }}>What was read</h2>
              <div className="card">
                {d.sources.map((s) => (
                  <div className="src" key={s.id}>
                    <div className="row"><span className="ref">{s.id}</span><b style={{ fontWeight: 500 }}>{s.title}</b><span className="tag">{s.kind}</span>
                      {s.extractionStatus !== "complete" && <span className="tag" style={{ color: "var(--amber)" }}>{s.extractionStatus}</span>}</div>
                    {s.warnings.map((w, i) => <div key={i} className="help" style={{ marginTop: 4 }}>{w}</div>)}
                    <pre>{s.text.length > 2000 ? `${s.text.slice(0, 2000)}\n… (${s.text.length.toLocaleString()} characters; shortened here)` : s.text}</pre>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="side" aria-label="Task actions">
          <div className="card">
            <div className="eyebrow">Files</div>
            {files.length === 0 && <p className="muted" style={{ margin: "10px 0 0", fontSize: 14 }}>{t.status === "ready" || t.status === "approved" ? "No files." : "Files appear here only after they are fully generated and verified."}</p>}
            <div style={{ marginTop: 8 }}>
              {files.map((f) => (
                <div className="file" key={f.id}>
                  <div className={`file-ic ${f.format}`}>{f.format.toUpperCase()}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="file-name">{f.filename}</div>
                    <div className="file-meta">{bytes(f.sizeBytes)} · rev {f.revision}</div>
                  </div>
                  <a className="btn btn-secondary btn-sm" href={f.downloadPath} download>Download</a>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="eyebrow">Review</div>
            {t.status === "ready" && (
              <>
                <p className="muted" style={{ fontSize: 14, margin: "10px 0 16px" }}>Marking reviewed records that you accepted this revision. It does not send, submit or publish anything.</p>
                <div className="stack">
                  <button className="btn btn-primary btn-block" disabled={busy !== null}
                    onClick={() => act("approve", () => api(`/tasks/${id}/review`, { method: "POST", body: { revision: rev, action: "approve" } }), "Marked reviewed. Nothing was sent.")}>
                    {busy === "approve" ? <span className="spin" /> : "Mark reviewed"}
                  </button>
                  <button className="btn btn-ghost btn-block" disabled={busy !== null}
                    onClick={() => act("dismiss", () => api(`/tasks/${id}/review`, { method: "POST", body: { revision: rev, action: "dismiss" } }), "Dismissed.")}>Dismiss</button>
                </div>
              </>
            )}
            {t.status === "approved" && <p style={{ margin: "10px 0 0", color: "var(--green)" }}>Marked reviewed. Nothing was sent.</p>}
            {t.status === "dismissed" && <p className="muted" style={{ margin: "10px 0 0" }}>Dismissed.</p>}
            {t.status === "failed" && (
              <>
                <p className="muted" style={{ fontSize: 14, margin: "10px 0 16px" }}>Retrying starts a new revision with the same input.</p>
                <div className="stack">
                  <button className="btn btn-primary btn-block" disabled={busy !== null}
                    onClick={() => act("retry", () => api(`/tasks/${id}/retry`, { method: "POST", body: { revision: rev } }), "Retry queued as a new revision.")}>
                    {busy === "retry" ? <span className="spin" /> : "Retry"}
                  </button>
                  <button className="btn btn-ghost btn-block" disabled={busy !== null}
                    onClick={() => act("dismiss", () => api(`/tasks/${id}/review`, { method: "POST", body: { revision: rev, action: "dismiss" } }), "Dismissed.")}>Dismiss</button>
                </div>
              </>
            )}
            {(t.status === "needs_input" || t.status === "skipped") && (
              <div className="stack" style={{ marginTop: 12 }}>
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>{t.status === "needs_input" ? "Answer the questions on the left to continue, or dismiss this task." : "Nothing to review."}</p>
                <button className="btn btn-ghost btn-block" disabled={busy !== null}
                  onClick={() => act("dismiss", () => api(`/tasks/${id}/review`, { method: "POST", body: { revision: rev, action: "dismiss" } }), "Dismissed.")}>Dismiss</button>
              </div>
            )}
            {ACTIVE.has(t.status) && <p className="muted" style={{ fontSize: 14, margin: "10px 0 0" }}>Being prepared. You can close this page; the worker keeps going.</p>}
          </div>

          <div className="card">
            <div className="eyebrow">Notifications</div>
            {d.notifications.length === 0 && <p className="muted" style={{ fontSize: 14, margin: "10px 0 0" }}>None yet. One is created when files are ready.</p>}
            {d.notifications.map((n) => (
              <div key={n.id} style={{ marginTop: 12, fontSize: 14 }}>
                <div className="row"><span className="tag solid">{n.channel}</span><span className="tag">{n.state === "simulated" ? "simulated (not sent to a phone)" : n.state}</span></div>
                <div className="muted" style={{ marginTop: 6 }}>{n.message}</div>
                {n.lastError && <div style={{ color: "var(--red)", marginTop: 4 }}>{n.lastError}</div>}
              </div>
            ))}
          </div>

          <dl className="kv card" style={{ margin: 0 }}>
            <dt>Task</dt><dd className="mono" style={{ fontSize: 12 }}>{t.id}</dd>
            <dt>Requested</dt><dd>{t.requestedOutputs.join(", ") || "—"}</dd>
            <dt>Updated</dt><dd>{when(t.updatedAt)}</dd>
            {d.answers.length > 0 && <><dt>Answers</dt><dd>{d.answers.length} saved</dd></>}
          </dl>
        </aside>
      </div>
    </div>
  );
}
