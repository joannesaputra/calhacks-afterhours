"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, api } from "../lib/api";
import { safeNext } from "../lib/next";
import { Badge, Notice } from "../components/ui";

export default function Login() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/session", { method: "POST", body: { password } });
      router.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "That password is not correct." :
        err instanceof ApiError && err.status === 429 ? "Too many attempts. Wait a moment and try again." :
        "Could not sign in. Is the API running?");
      setBusy(false);
    }
  }

  return (
    <div className="inner">
      <div className="login">
        <Badge chip="Private">Single-workspace prototype</Badge>
        <h1 className="h1" style={{ fontSize: 44, margin: "24px auto 12px" }}>Sign in</h1>
        <p className="muted" style={{ margin: "0 0 28px" }}>Use the workspace password from your local setup.</p>
        <form onSubmit={submit} className="stack" style={{ textAlign: "left" }}>
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" className="input pillish" type="password" autoComplete="current-password" autoFocus
            value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <Notice tone="bad">{error}</Notice>}
          <button className="btn btn-primary btn-block" disabled={busy || password === ""}>
            {busy ? <span className="spin" /> : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
