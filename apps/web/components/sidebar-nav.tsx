"use client";
import { Suspense, useMemo, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, Inbox, Settings } from "lucide-react";
import { useNotificationList, useTaskList } from "@/lib/hooks";
import { FILTERS, isUrgentNotification } from "@/lib/labels";
import { QUEUE_LAYOUT } from "@/lib/queue";

function Count({ n, tone }: { n: number | undefined; tone?: "bad" }) {
  if (n === undefined) return null;
  return <span className={`nav-count${tone === "bad" && n > 0 ? " nav-count-bad" : ""}`}>{n}</span>;
}

function Items({ onNavigate }: { onNavigate: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const tasks = useTaskList();
  const notifications = useNotificationList();

  const counts = useMemo(() => {
    if (!tasks.data) return undefined;
    const out: Record<string, number> = {};
    for (const f of FILTERS) out[f.id] = f.statuses ? tasks.data.items.filter((t) => f.statuses!.includes(t.status)).length : tasks.data.items.length;
    return out;
  }, [tasks.data]);
  const urgent = useMemo(
    () => (notifications.data ? notifications.data.pages.flatMap((p) => p.items).filter(isUrgentNotification).length : undefined),
    [notifications.data],
  );

  const onQueue = pathname === "/" || pathname.startsWith("/tasks");
  const openBar = pathname === "/" ? params.get("open") : null;
  const onNotifications = pathname.startsWith("/notifications");
  const urgentOnly = onNotifications && params.get("filter") === "urgent";

  return (
    <ul>
      <li>
        <Link href="/" className="nav-link" aria-current={onQueue && !openBar ? "page" : undefined} data-group-active={onQueue || undefined} onClick={onNavigate}>
          <Inbox size={18} aria-hidden /><span>Work queue</span>
        </Link>
        {QUEUE_LAYOUT === "accordion" && (
          <ul className="subnav" aria-label="Work queue sections">
            {FILTERS.filter((f) => f.statuses).map((f) => (
              <li key={f.id}>
                <Link href={`/?open=${f.id}`} className="nav-sub" aria-current={openBar === f.id ? "page" : undefined} onClick={onNavigate}>
                  <span>{f.label}</span><Count n={counts?.[f.id]} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </li>
      <li>
        <Link href="/notifications" className="nav-link" aria-current={onNotifications && !urgentOnly ? "page" : undefined} data-group-active={onNotifications || undefined} onClick={onNavigate}>
          <Bell size={18} aria-hidden /><span>Notifications</span>
        </Link>
        <ul className="subnav" aria-label="Notification views">
          <li>
            <Link href="/notifications?filter=urgent" className="nav-sub" aria-current={urgentOnly ? "page" : undefined} title="Notifications that failed or were blocked, so nothing reached you" onClick={onNavigate}>
              <span>Urgent</span><Count n={urgent} tone="bad" />
            </Link>
          </li>
        </ul>
      </li>
      <li>
        <Link href="/settings" className="nav-link" aria-current={pathname.startsWith("/settings") ? "page" : undefined} onClick={onNavigate}>
          <Settings size={18} aria-hidden /><span>Settings</span>
        </Link>
      </li>
    </ul>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <Suspense fallback={null}>
      <Items onNavigate={onNavigate} />
    </Suspense>
  );
}
