"use client";
import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { NotificationRow } from "@/components/notification-row";
import { useShell } from "@/components/shell";
import { EmptyPanel, ErrorPanel, SkeletonCards } from "@/components/states";
import { useNotificationList, useSettings } from "@/lib/hooks";
import { isUrgentNotification } from "@/lib/labels";

function Notifications() {
  const urgentOnly = useSearchParams().get("filter") === "urgent";
  const list = useNotificationList();
  const settings = useSettings();
  const { integrations } = useShell();
  const tz = settings.data?.organization.timezone;
  const all = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const items = urgentOnly ? all.filter(isUrgentNotification) : all;
  const channel = integrations?.notifications.channel;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{urgentOnly ? "Urgent notifications" : "Notifications"}</h1>
          <p className="muted">
            {urgentOnly
              ? "Notifications that failed or were blocked, so they did not reach you. The finished work is still in the work queue."
              : channel === "whatsapp"
              ? "Messages sent through WhatsApp. “Accepted by provider” means the provider took the request, not that it reached a phone."
              : "Outbox mode: each message below is shown exactly as it would be sent, but nothing is sent to a phone or inbox."}
          </p>
        </div>
      </div>
      {list.isPending && <SkeletonCards />}
      {list.isError && <ErrorPanel error={list.error} title="Could not load notifications" onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && (
        <EmptyPanel title={urgentOnly ? "Nothing urgent" : "No notifications yet"}><p>{urgentOnly ? "No notification has failed or been blocked." : "A notification is created when a task becomes ready for review."}</p></EmptyPanel>
      )}
      <div className="stack">
        {items.map((n) => <NotificationRow key={n.id} record={n} timeZone={tz} />)}
      </div>
      {list.hasNextPage && (
        <p>
          <button type="button" className="btn btn-secondary" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? <><Loader2 size={16} className="spin" aria-hidden />Loading…</> : "Load older notifications"}
          </button>
        </p>
      )}
    </>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={<SkeletonCards />}>
      <Notifications />
    </Suspense>
  );
}
