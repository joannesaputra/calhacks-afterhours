// Browser-side API access. All calls use relative /api URLs (proxied to the API's /v1).
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: T; error?: { code?: string; message?: string; details?: unknown } }
    | null;
  if (!res.ok || !json || json.data === undefined) {
    throw new ApiError(res.status, json?.error?.code ?? "ERROR", json?.error?.message ?? res.statusText, json?.error?.details);
  }
  return json.data;
}

export const ACTIVE = new Set(["queued", "planning", "running"]);

export const STATUS_LABEL: Record<string, string> = {
  queued: "Queued", planning: "Planning", running: "Generating", needs_input: "Needs input", ready: "Ready to review",
  approved: "Marked reviewed", dismissed: "Dismissed", failed: "Failed", skipped: "Skipped",
};

export function statusTone(s: string): "ok" | "warn" | "bad" | "" {
  if (s === "ready" || s === "approved") return "ok";
  if (s === "needs_input" || s === "running" || s === "planning" || s === "queued") return "warn";
  if (s === "failed") return "bad";
  return "";
}

export function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
