"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { TaskSummary } from "@afterhours/contracts";
import { useShell } from "@/components/shell";
import { DemoMenu } from "@/components/demo-menu";
import { TaskCard } from "@/components/task-card";
import { EmptyPanel, ErrorPanel, SkeletonCards } from "@/components/states";
import { useNow, useTaskList } from "@/lib/hooks";
import { FILTERS, filterHref, parseFilter, sortForQueue, type QueueFilter } from "@/lib/labels";
import { QUEUE_LAYOUT, SORTS, parseSort, senderLabel, sortTasks, sourceLabel } from "@/lib/queue";

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

/** Version A: one drop-down bar per status; the sidebar links open a bar. */
function Accordion({ items, now, loaded }: { items: TaskSummary[]; now: number; loaded: boolean }) {
  const open = useSearchParams().get("open");
  const [expanded, setExpanded] = useState<Set<QueueFilter>>(new Set(["ready"]));
  useEffect(() => {
    const target = STATUS_VIEWS.find((f) => f.id === open);
    if (!target) return;
    setExpanded((prev) => new Set(prev).add(target.id));
    document.getElementById(`queue-${target.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [open]);
  const toggle = (id: QueueFilter) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="bars">
      {STATUS_VIEWS.map((f) => {
        const tasks = sortTasks(items.filter((t) => inView(t, f)), "recent");
        const isOpen = expanded.has(f.id);
        return (
          <section key={f.id} id={`queue-${f.id}`} className="bar">
            <h2 className="bar-head">
              <button type="button" className="bar-toggle" aria-expanded={isOpen} aria-controls={`bar-${f.id}`} onClick={() => toggle(f.id)}>
                <span>{f.label}</span>
                {loaded && <span className="count">{tasks.length}</span>}
                <ChevronDown size={18} aria-hidden className="bar-chevron" />
              </button>
            </h2>
            {isOpen && (
              <div id={`bar-${f.id}`} className="bar-body stack">
                {tasks.length === 0 ? <p className="muted bar-empty">Nothing here.</p> : tasks.map((t) => <TaskCard key={t.id} task={t} nowMs={now} />)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Version B: status bubbles that open each page, plus a filter bar (sort, sender, source). */
function Bubbles({ items, now, loaded, filter }: { items: TaskSummary[]; now: number; loaded: boolean; filter: QueueFilter }) {
  const router = useRouter();
  const params = useSearchParams();
  const sort = parseSort(params.get("sort"));
  const from = params.get("from") ?? "";
  const source = params.get("source") ?? "";
  const active = FILTERS.find((f) => f.id === filter)!;

  const inStatus = useMemo(() => items.filter((t) => inView(t, active)), [items, active]);
  const senders = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of items) m.set(t.senderEmail.toLowerCase(), senderLabel(t));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);
  const sources = useMemo(() => [...new Set(items.map((t) => t.ingestionMode))], [items]);
  const shown = useMemo(
    () => sortTasks(inStatus.filter((t) => (!from || t.senderEmail.toLowerCase() === from) && (!source || t.ingestionMode === source)), sort),
    [inStatus, from, source, sort],
  );
  const counts = (f: (typeof FILTERS)[number]) => items.filter((t) => inView(t, f)).length;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    const q = next.toString();
    router.replace(q ? `/?${q}` : "/");
  };
  const keep = (id: QueueFilter) => {
    const base = filterHref(id);
    const extras = new URLSearchParams();
    for (const k of ["sort", "from", "source"]) if (params.get(k)) extras.set(k, params.get(k)!);
    const e = extras.toString();
    return e ? `${base}${base.includes("?") ? "&" : "?"}${e}` : base;
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
      <nav className="bubbles" aria-label="Work queue pages">
        {FILTERS.map((f) => (
          <Link key={f.id} href={keep(f.id)} className="bubble" aria-current={filter === f.id ? "page" : undefined}>
            {f.label}{loaded && <span className="count">{counts(f)}</span>}
          </Link>
        ))}
      </nav>

      <div className="filterbar" role="group" aria-label="Sort and filter">
        <label>Sort
          <select value={sort} onChange={(e) => setParam("sort", e.target.value === "recent" ? "" : e.target.value)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label>Sent from
          <select value={from} onChange={(e) => setParam("from", e.target.value)}>
            <option value="">Everyone</option>
            {senders.map(([email, label]) => <option key={email} value={email}>{label}</option>)}
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
        <EmptyPanel title={`Nothing in “${active.label}”`}><p>{from || source ? "No work matches these filters." : "Try another page."}</p></EmptyPanel>
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
  const title = QUEUE_LAYOUT === "bubbles" && active.id !== "all" ? active.label : "Work queue";

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

      {loaded && items.length > 0 && (QUEUE_LAYOUT === "bubbles"
        ? <Bubbles items={items} now={now} loaded={loaded} filter={filter} />
        : <Accordion items={items} now={now} loaded={loaded} />)}
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
