"use client";
import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { TaskSummary } from "@afterhours/contracts";
import { useShell } from "@/components/shell";
import { DemoMenu } from "@/components/demo-menu";
import { TaskCard } from "@/components/task-card";
import { Avatar } from "@/components/sender";
import { EmptyPanel, ErrorPanel, SkeletonCards } from "@/components/states";
import { useNow, useTaskList } from "@/lib/hooks";
import { FILTERS, filterHref, parseFilter, sortForQueue, type QueueFilter } from "@/lib/labels";
import { SORTS, parseSort, senderLabel, sortTasks, sourceLabel } from "@/lib/queue";

const STATUS_VIEWS = FILTERS.filter((f) => f.statuses);
const inView = (t: TaskSummary, f: (typeof FILTERS)[number]) => !f.statuses || f.statuses.includes(t.status);

function Intro({ readyCount, loaded }: { readyCount: number; loaded: boolean }) {
  return (
    <p className="muted">
      {loaded
        ? readyCount > 0
          ? `${readyCount} result${readyCount === 1 ? " is" : "s are"} ready for review. Requests from approved senders are prepared automatically.`
          : "Requests from approved senders are prepared automatically. Finished work appears here for review."
        : "Requests from approved senders are prepared automatically."}
    </p>
  );
}

/** Sender strip, sort and platform filters, then the cards. The status views live in the sidebar (chips on phones). */
function QueueView({ items, now, loaded, filter }: { items: TaskSummary[]; now: number; loaded: boolean; filter: QueueFilter }) {
  const router = useRouter();
  const params = useSearchParams();
  const sort = parseSort(params.get("sort"));
  const from = params.get("from") ?? "";
  const source = params.get("source") ?? "";
  const active = FILTERS.find((f) => f.id === filter)!;

  const inStatus = useMemo(() => items.filter((t) => inView(t, active)), [items, active]);
  const senders = useMemo(() => {
    const m = new Map<string, { email: string; label: string; n: number }>();
    for (const t of inStatus) {
      const k = t.senderEmail.toLowerCase();
      const g = m.get(k) ?? { email: k, label: senderLabel(t), n: 0 };
      g.n += 1;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [inStatus]);
  const sources = useMemo(() => [...new Set(items.map((t) => t.ingestionMode))], [items]);
  const shown = useMemo(
    () => sortTasks(inStatus.filter((t) => (!from || t.senderEmail.toLowerCase() === from) && (!source || t.ingestionMode === source)), sort),
    [inStatus, from, source, sort],
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    const q = next.toString();
    router.replace(q ? `/?${q}` : "/");
  };

  const groups = useMemo(() => {
    if (sort !== "sender") return [{ key: "all", label: "", tasks: shown }];
    const m = new Map<string, { key: string; label: string; tasks: TaskSummary[] }>();
    for (const t of shown) {
      const k = t.senderEmail.toLowerCase();
      const g = m.get(k) ?? { key: k, label: senderLabel(t), tasks: [] };
      g.tasks.push(t);
      m.set(k, g);
    }
    return [...m.values()];
  }, [shown, sort]);

  return (
    <>
      <div className="filters" role="group" aria-label="Queue views">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="filter" aria-pressed={filter === f.id} onClick={() => router.replace(filterHref(f.id))}>
            {f.label}{loaded ? <span className="count">{items.filter((t) => inView(t, f)).length}</span> : null}
          </button>
        ))}
      </div>

      {senders.length > 0 && (
        <div className="senders" role="group" aria-label="Filter by sender">
          <button type="button" className="sender-pick" aria-pressed={from === ""} onClick={() => setParam("from", "")}>
            <span className="sender-all" aria-hidden>All</span>
            <span className="sender-label">Everyone</span>
          </button>
          {senders.map((s) => (
            <button key={s.email} type="button" className="sender-pick" aria-pressed={from === s.email} title={s.email} onClick={() => setParam("from", from === s.email ? "" : s.email)}>
              <Avatar name={s.label} email={s.email} />
              <span className="sender-label">{s.label}</span>
              <span className="sender-n">{s.n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="filterbar" role="group" aria-label="Sort and filter">
        <label>Sort
          <select value={sort} onChange={(e) => setParam("sort", e.target.value === "recent" ? "" : e.target.value)}>
            {SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <label>Platform
          <select value={source} onChange={(e) => setParam("source", e.target.value)}>
            <option value="">All platforms</option>
            {sources.map((m) => <option key={m} value={m}>{sourceLabel(m)}</option>)}
          </select>
        </label>
        {(from || source || sort !== "recent") && (
          <button type="button" className="btn btn-ghost" onClick={() => router.replace(filterHref(filter))}>Clear</button>
        )}
      </div>

      {loaded && shown.length === 0 && (
        <EmptyPanel title={`Nothing in “${active.label}”`}><p>{from || source ? "No work matches these filters." : "Try another view."}</p></EmptyPanel>
      )}
      {groups.map((g) => (
        <section key={g.key} className={g.label ? "sender-group" : undefined} aria-label={g.label ? `From ${g.label}` : undefined}>
          {g.label && <h2 className="sender-head wrap-anywhere"><span>From {g.label}</span><span className="count">{g.tasks.length}</span></h2>}
          <div className="stack">{g.tasks.map((t) => <TaskCard key={t.id} task={t} nowMs={now} />)}</div>
        </section>
      ))}
    </>
  );
}

function Queue() {
  const { demoEnabled, integrations } = useShell();
  const list = useTaskList();
  const filter = parseFilter(useSearchParams().get("filter"));
  const now = useNow(true, 30_000);
  const items = useMemo(() => sortForQueue(list.data?.items ?? []), [list.data]);
  const readyCount = items.filter((t) => t.status === "ready").length;
  const loaded = !!list.data;
  const active = FILTERS.find((f) => f.id === filter)!;
  const title = active.id === "all" ? "Work queue" : active.label;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <Intro readyCount={readyCount} loaded={loaded} />
        </div>
        {demoEnabled && <DemoMenu />}
      </div>

      {list.isPending && <SkeletonCards />}
      {list.isError && <ErrorPanel error={list.error} title="Could not load the work queue" onRetry={() => void list.refetch()} />}
      {list.data?.truncated && (
        <p className="banner banner-info" role="status">Showing the most recent {list.data.items.length} tasks. Older tasks are not loaded in this view.</p>
      )}

      {loaded && items.length === 0 && (
        <EmptyPanel title="No work yet">
          <p>
            AfterHours prepares files when an approved sender emails a supported request.{" "}
            {integrations?.gmail.state === "disconnected" && <>Gmail is not connected. <Link href="/settings">Connect Gmail in Settings</Link>.</>}
            {integrations?.gmail.state === "error" && <>Gmail reports an error{integrations.gmail.lastError ? `: ${integrations.gmail.lastError}` : ""}. <Link href="/settings">Check Settings</Link>.</>}
            {integrations?.gmail.state === "connected" && <>Gmail is connected, so new messages from approved senders will appear here.</>}
            {demoEnabled && <> You can also run a labeled demo from the “Run demo” menu.</>}
          </p>
        </EmptyPanel>
      )}

      {loaded && items.length > 0 && <QueueView items={items} now={now} loaded={loaded} filter={filter} />}
    </>
  );
}

export default function QueuePage() {
  return (
    <Suspense fallback={<SkeletonCards />}>
      <Queue />
    </Suspense>
  );
}
