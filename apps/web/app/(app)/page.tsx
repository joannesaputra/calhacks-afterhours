"use client";
import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useShell } from "@/components/shell";
import { DemoMenu } from "@/components/demo-menu";
import { TaskCard } from "@/components/task-card";
import { EmptyPanel, ErrorPanel, SkeletonCards } from "@/components/states";
import { useNow, useTaskList } from "@/lib/hooks";
import { FILTERS, filterHref, parseFilter, sortForQueue, type QueueFilter } from "@/lib/labels";

function Queue() {
  const router = useRouter();
  const { demoEnabled, integrations } = useShell();
  const list = useTaskList();
  const filter = parseFilter(useSearchParams().get("filter"));
  const now = useNow(true, 30_000);

  const items = useMemo(() => sortForQueue(list.data?.items ?? []), [list.data]);
  const counts = useMemo(() => {
    const out = {} as Record<QueueFilter, number>;
    for (const f of FILTERS) out[f.id] = f.statuses ? items.filter((t) => f.statuses!.includes(t.status)).length : items.length;
    return out;
  }, [items]);
  const active = FILTERS.find((f) => f.id === filter)!;
  const shown = active.statuses ? items.filter((t) => active.statuses!.includes(t.status)) : items;
  const readyCount = counts.ready;
  // Group by sender address. Groups keep the queue's own order (first task decides the group's position).
  const groups = useMemo(() => {
    const byEmail = new Map<string, { email: string; label: string; tasks: typeof shown }>();
    for (const t of shown) {
      const key = t.senderEmail.toLowerCase();
      const g = byEmail.get(key) ?? { email: key, label: t.senderName ? `${t.senderName} <${t.senderEmail}>` : t.senderEmail, tasks: [] };
      g.tasks.push(t);
      byEmail.set(key, g);
    }
    return [...byEmail.values()];
  }, [shown]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{active.id === "all" ? "Work queue" : active.label}</h1>
          <p className="muted">
            {list.data
              ? readyCount > 0
                ? `${readyCount} result${readyCount === 1 ? " is" : "s are"} ready for review. Requests from approved senders are prepared automatically.`
                : "Requests from approved senders are prepared automatically. Finished work appears here for review."
              : "Requests from approved senders are prepared automatically."}
          </p>
        </div>
        {demoEnabled && <DemoMenu />}
      </div>

      <div className="filters" role="group" aria-label="Filter tasks">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="filter" aria-pressed={filter === f.id} onClick={() => router.replace(filterHref(f.id))}>
            {f.label}{list.data ? <span className="count">{counts[f.id]}</span> : null}
          </button>
        ))}
      </div>

      {list.isPending && <SkeletonCards />}
      {list.isError && <ErrorPanel error={list.error} title="Could not load the work queue" onRetry={() => void list.refetch()} />}
      {list.data?.truncated && (
        <p className="banner banner-info" role="status">Showing the most recent {list.data.items.length} tasks. Older tasks are not loaded in this view.</p>
      )}

      {list.data && shown.length === 0 && (
        items.length === 0 ? (
          <EmptyPanel title="No work yet">
            <p>
              AfterHours prepares files when an approved sender emails a supported request.{" "}
              {integrations?.gmail.state === "disconnected" && <>Gmail is not connected. <Link href="/settings">Connect Gmail in Settings</Link>.</>}
              {integrations?.gmail.state === "error" && <>Gmail reports an error{integrations.gmail.lastError ? `: ${integrations.gmail.lastError}` : ""}. <Link href="/settings">Check Settings</Link>.</>}
              {integrations?.gmail.state === "connected" && <>Gmail is connected, so new messages from approved senders will appear here.</>}
              {demoEnabled && <> You can also run a labeled demo from the “Run demo” menu.</>}
            </p>
          </EmptyPanel>
        ) : (
          <EmptyPanel title={`Nothing in “${active.label}”`}><p>Try another filter.</p></EmptyPanel>
        )
      )}

      {groups.map((g) => (
        <section key={g.email} className="sender-group" aria-label={`From ${g.label}`}>
          <h2 className="sender-head wrap-anywhere">
            <span>From {g.label}</span>
            <span className="count">{g.tasks.length}</span>
          </h2>
          <div className="stack">
            {g.tasks.map((t) => <TaskCard key={t.id} task={t} nowMs={now} />)}
          </div>
        </section>
      ))}
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
