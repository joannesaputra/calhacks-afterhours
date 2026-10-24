"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

/** Load a resource; re-poll every `intervalMs` while `intervalMs` is a number and the tab is visible. */
export function useResource<T>(load: () => Promise<T>, intervalMs: number | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Request failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, deps);

  useEffect(() => {
    if (intervalMs == null) return;
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, refresh]);

  return { data, error, loading, refresh };
}
