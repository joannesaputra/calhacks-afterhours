"use client";
import { BrandMark } from "@/components/brand";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LockKeyhole } from "lucide-react";
import { ApiError, api, safeReturnTo } from "@/lib/api";

function loginMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Incorrect password.";
    if (e.status === 429) return "Too many attempts. Wait a minute and try again.";
    if (e.status === 0 || e.code === "SERVICE_UNAVAILABLE") return "The server is not reachable. Check that the app is running.";
    if (e.status === 403) return "The sign-in request was blocked. Open the app at its configured address.";
  }
  return "Could not sign in. Please try again.";
}

export function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const returnTo = safeReturnTo(useSearchParams().get("returnTo"));
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A visitor who is already signed in goes straight on.
  useEffect(() => {
    const c = new AbortController();
    api.session(c.signal).then((s) => s.authenticated && router.replace(returnTo)).catch(() => undefined);
    return () => c.abort();
  }, [router, returnTo]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending || !password) return;
    setPending(true);
    setError(null);
    try {
      await api.login(password);
      qc.clear();
      router.replace(returnTo);
    } catch (err) {
      setError(loginMessage(err));
      setPending(false);
    }
  }

  return (
    <form className="card login-card" onSubmit={submit} noValidate>
      <div className="brand">
        <BrandMark />
        <span className="brand-name">AfterHours</span>
        <span className="brand-sub">Work ready for review</span>
      </div>
      <h1 className="h2"><LockKeyhole size={20} aria-hidden /> Private workspace</h1>
      <p className="muted">Enter the workspace password to continue.</p>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>
      {error && <p id="login-error" className="field-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={pending || !password}>
        {pending ? <><Loader2 size={16} className="spin" aria-hidden />Signing in…</> : "Sign in"}
      </button>
    </form>
  );
}
