"use client";
// Data hooks. One cache (TanStack Query); mutations are explicit handlers, never mount effects.
import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { ContextCorrectionBody, CreateGrantBody, ReplySendBody, SettingsPatch, TaskDetail, TaskSummary, WorkAnswer } from "@afterhours/contracts";
import { api } from "./api";
import { isActive } from "./labels";

export const keys = {
  session: ["session"] as const,
  tasks: ["tasks"] as const,
  task: (id: string) => ["task", id] as const,
  notifications: ["notifications"] as const,
  settings: ["settings"] as const,
  integrations: ["integrations"] as const,
  context: ["context"] as const,
  taskContext: (id: string) => ["task-context", id] as const,
  reply: (id: string) => ["reply", id] as const,
};

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

export function useSession() {
  return useQuery({ queryKey: keys.session, queryFn: ({ signal }) => api.session(signal), staleTime: 30_000, retry: false });
}

const PAGE = 100;
const MAX_PAGES = 5;
export interface TaskList {
  items: TaskSummary[];
  /** True when more tasks exist than were loaded; the UI must say so instead of implying a full list. */
  truncated: boolean;
}

/** All tasks, newest first. Polls every 2 s while anything is active, slowly when idle, never while hidden. */
export function useTaskList() {
  return useQuery<TaskList>({
    queryKey: keys.tasks,
    queryFn: async ({ signal }) => {
      const items: TaskSummary[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await api.tasks({ cursor, limit: PAGE }, signal);
        items.push(...res.items);
        cursor = res.nextCursor;
        if (!cursor) return { items, truncated: false };
      }
      return { items, truncated: true };
    },
    refetchInterval: (q) => {
      if (hidden()) return false;
      return q.state.data?.items.some((t) => isActive(t.status)) ? 2000 : 15_000;
    },
  });
}

export function taskPollInterval(d: TaskDetail | undefined): number | false {
  if (hidden() || !d) return false;
  if (isActive(d.task.status)) return 2000;
  if (d.task.status === "ready" && d.notifications.every((n) => n.state === "queued")) return 5000;
  return false;
}

export function useTask(id: string) {
  return useQuery({
    queryKey: keys.task(id),
    queryFn: ({ signal }) => api.task(id, signal),
    refetchInterval: (q) => taskPollInterval(q.state.data),
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 2,
  });
}

export function useIntegrations(enabled = true) {
  return useQuery({
    enabled,
    queryKey: keys.integrations,
    queryFn: ({ signal }) => api.integrations(signal),
    refetchInterval: () => (hidden() ? false : 10_000),
  });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: ({ signal }) => api.settings(signal), staleTime: 30_000 });
}

export function useNotificationList() {
  return useInfiniteQuery({
    queryKey: keys.notifications,
    queryFn: ({ pageParam, signal }) => api.notifications(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: () => (hidden() ? false : 10_000),
  });
}

function refreshTask(qc: QueryClient, id: string) {
  void qc.invalidateQueries({ queryKey: keys.task(id) });
  void qc.invalidateQueries({ queryKey: keys.tasks });
  void qc.invalidateQueries({ queryKey: keys.notifications });
}

export function useReview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { revision: number; action: "approve" | "dismiss" }) => api.review(id, v.revision, v.action),
    // Always re-read server state: on success to show the result, on a 409 to show the current revision.
    onSettled: () => refreshTask(qc, id),
  });
}

export function useSubmitAnswers(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { revision: number; answers: WorkAnswer[] }) => api.answers(id, v.revision, v.answers),
    onSettled: () => refreshTask(qc, id),
  });
}

export function useRetry(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { revision: number }) => api.retry(id, v.revision),
    onSettled: () => refreshTask(qc, id),
  });
}

export function useInject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { scenario: "proposal" | "report" | "ambiguous" | "no_action" | "revision" | "revision_choice"; replayKey: string }) =>
      api.inject(v.scenario, v.replayKey),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.tasks }),
  });
}

export function usePatchSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.patchSettings(patch),
    onSuccess: (data) => {
      qc.setQueryData(keys.settings, data);
      void qc.invalidateQueries({ queryKey: keys.integrations });
    },
  });
}

export function useDisconnectGmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.disconnectGmail(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.integrations }),
  });
}

/** Ticking clock for elapsed-time displays; only runs while `enabled`. */
export function useNow(enabled: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [enabled, everyMs]);
  return now;
}

/** Context used for one task. Polls while the task is active so the phase label tracks the worker. */
export function useTaskContext(id: string, active: boolean) {
  return useQuery({
    queryKey: keys.taskContext(id),
    queryFn: ({ signal }) => api.taskContext(id, signal),
    refetchInterval: () => (hidden() || !active ? false : 2000),
    retry: false,
  });
}

export function useContextCorrection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContextCorrectionBody) => api.correctContext(id, body),
    onSettled: () => { refreshTask(qc, id); void qc.invalidateQueries({ queryKey: keys.taskContext(id) }); },
  });
}

export function useContextStatus() {
  return useQuery({ queryKey: keys.context, queryFn: ({ signal }) => api.context(signal), refetchInterval: () => (hidden() ? false : 10_000) });
}

export function useContextGrants() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: keys.context });
  return {
    create: useMutation({ mutationFn: (b: CreateGrantBody) => api.createGrant(b), onSuccess: done }),
    revoke: useMutation({ mutationFn: (id: string) => api.revokeGrant(id), onSuccess: done }),
    purge: useMutation({ mutationFn: (id: string) => api.purgeGrant(id), onSuccess: done }),
  };
}

/** The reply panel for a reviewed task: who it goes to, what is attached, and why it cannot be sent when it cannot. */
export function useReply(id: string, enabled: boolean) {
  return useQuery({ enabled, queryKey: keys.reply(id), queryFn: ({ signal }) => api.reply(id, signal), retry: false });
}

export function useSendReply(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReplySendBody) => api.sendReply(id, body),
    // Re-read both: the panel shows the outcome, and the task's activity log gains the "Reply sent" entry.
    onSettled: () => { void qc.invalidateQueries({ queryKey: keys.reply(id) }); refreshTask(qc, id); },
  });
}

/** Permanently delete a task. The task is removed from every cached list so it cannot flash back before the next refresh. */
export function useDeleteTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteTask(id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.task(id) });
      qc.removeQueries({ queryKey: keys.taskContext(id) });
      qc.removeQueries({ queryKey: keys.reply(id) });
      void qc.invalidateQueries({ queryKey: keys.tasks });
      void qc.invalidateQueries({ queryKey: keys.notifications });
    },
  });
}
