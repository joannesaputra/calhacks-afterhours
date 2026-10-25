"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, FlaskConical, Loader2, Repeat } from "lucide-react";
import { describeError } from "@/lib/api";
import { useInject } from "@/lib/hooks";
import { useToast } from "./providers";

type Scenario = "proposal" | "report" | "ambiguous" | "no_action" | "revision" | "revision_choice";
const SCENARIOS: Array<{ id: Scenario; label: string; note: string }> = [
  { id: "proposal", label: "Proposal + kickoff deck", note: "Client brief with attachment" },
  { id: "report", label: "Sales CSV report + slides", note: "CSV attachment, calculated figures" },
  { id: "ambiguous", label: "Ambiguous request", note: "Asks you clarifying questions" },
  { id: "no_action", label: "Newsletter (no action)", note: "Should be skipped" },
  { id: "revision", label: "Revise an attached deck", note: "Edits the attached .pptx in place" },
  { id: "revision_choice", label: "Revise: which deck?", note: "Two decks attached; asks you to choose" },
];
const LAST_KEY = "ah.lastDemo";

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function readLast(): { scenario: Scenario; key: string } | null {
  try {
    const raw = sessionStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as { scenario: Scenario; key: string }) : null;
  } catch {
    return null;
  }
}

/** Demo scenarios use the real injection endpoint. Labeled as demo data everywhere they appear. */
export function DemoMenu() {
  const router = useRouter();
  const toast = useToast();
  const inject = useInject();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [last, setLast] = useState<{ scenario: Scenario; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setLast(readLast()), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(scenario: Scenario, key: string, replay: boolean) {
    if (pending) return; // one injection in flight at a time
    setPending(replay ? "replay" : scenario);
    setError(null);
    try {
      const res = await inject.mutateAsync({ scenario, replayKey: key });
      if (!replay) {
        try { sessionStorage.setItem(LAST_KEY, JSON.stringify({ scenario, key })); } catch { /* storage unavailable */ }
        setLast({ scenario, key });
      }
      toast.push("success", res.deduplicated ? "Same message replayed: the existing task was reused, no duplicate was created." : "Demo email received and queued.");
      setOpen(false);
      router.push(`/tasks/${encodeURIComponent(res.taskId)}`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="menu-wrap" ref={wrap}>
      <button type="button" className="btn btn-secondary" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <FlaskConical size={16} aria-hidden />Run demo<ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div className="menu" role="group" aria-label="Demo scenarios">
          <p className="menu-note">Fictional emails sent through the same intake path as Gmail. Items are labeled “Demo email”.</p>
          {SCENARIOS.map((s) => (
            <button key={s.id} type="button" className="menu-item" disabled={pending !== null} onClick={() => run(s.id, newKey(), false)}>
              <span>
                <strong>{s.label}</strong>
                <span className="muted small block">{s.note}</span>
              </span>
              {pending === s.id && <Loader2 size={16} className="spin" aria-label="Sending" />}
            </button>
          ))}
          <hr />
          <button type="button" className="menu-item" disabled={pending !== null || !last} onClick={() => last && run(last.scenario, last.key, true)}>
            <span>
              <strong><Repeat size={14} aria-hidden /> Replay same message</strong>
              <span className="muted small block">
                {last ? "Re-delivers your last demo email. It should reuse the same task, showing duplicate protection." : "Run a scenario first. New demo runs always create new messages."}
              </span>
            </span>
            {pending === "replay" && <Loader2 size={16} className="spin" aria-label="Sending" />}
          </button>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
