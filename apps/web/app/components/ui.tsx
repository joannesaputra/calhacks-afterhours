"use client";
import { useEffect, useState, type ReactNode } from "react";
import { STATUS_LABEL, statusTone } from "../lib/api";

export function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  return <span className="status"><span className={`dot ${tone}`} />{STATUS_LABEL[status] ?? status}</span>;
}

export function Badge({ chip, children, href }: { chip?: string; children: ReactNode; href?: string }) {
  const inner = (
    <span className="badge">
      {chip && <span className="chip">{chip}</span>}
      <span>{children}</span>
      {href && <span className="arrow">↗</span>}
    </span>
  );
  return href ? <a href={href}>{inner}</a> : inner;
}

export function RotatingWord({ words }: { words: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (words.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % words.length), 2200);
    return () => clearInterval(t);
  }, [words]);
  return <span className="rot">{words[i]}</span>;
}

export function Notice({ tone = "", children }: { tone?: "warn" | "bad" | "ok" | ""; children: ReactNode }) {
  return <div className={`notice ${tone}`} role={tone === "bad" ? "alert" : undefined}>{children}</div>;
}

export function Term({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="term">
      <div className="term-bar"><i /><i /><i /><span>{title}</span></div>
      <div className="term-body">{children}</div>
    </div>
  );
}
