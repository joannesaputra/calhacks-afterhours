"use client";
import { useState } from "react";
import { CheckCircle2, Download, FileText, Loader2, Presentation, TriangleAlert } from "lucide-react";
import type { Artifact } from "@afterhours/contracts";
import { ApiError, describeError, fetchBinary } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useToast } from "./providers";

async function sha256Hex(blob: Blob): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type State = { kind: "idle" } | { kind: "busy" } | { kind: "done"; name: string; size: number; checked: boolean } | { kind: "error"; message: string };

/** Fetches the real file, checks it against the manifest (size, ZIP signature, checksum), then saves it. */
async function downloadVerified(a: Artifact): Promise<{ name: string; size: number; checked: boolean }> {
  const { blob, filename, contentType } = await fetchBinary(a.downloadPath);
  if (blob.size !== a.sizeBytes) throw new Error(`The downloaded file is ${blob.size} bytes but ${a.sizeBytes} were expected.`);
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error("The downloaded file is not a valid Office document.");
  if (!contentType.startsWith(a.mimeType) && !contentType.startsWith("application/octet-stream")) {
    throw new Error("The file type did not match what was expected.");
  }
  const digest = await sha256Hex(blob);
  if (digest !== null && digest !== a.sha256.toLowerCase()) throw new Error("The downloaded file failed its checksum.");
  const name = filename ?? a.filename;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
  return { name, size: blob.size, checked: digest !== null };
}

/** Download state machine shared by the file card and the preview drawer. */
export function useArtifactDownload(artifact: Artifact) {
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "idle" });
  async function start() {
    if (state.kind === "busy") return;
    setState({ kind: "busy" });
    try {
      const r = await downloadVerified(artifact);
      setState({ kind: "done", ...r });
      toast.push("success", `Downloaded ${r.name}.`);
    } catch (e) {
      const message = e instanceof ApiError ? describeError(e) : e instanceof Error ? e.message : "The download failed.";
      setState({ kind: "error", message });
      toast.push("error", `Download failed: ${message}`);
    }
  }
  return { state, start };
}

export function DownloadButton({ artifact, state, start, className = "btn btn-secondary" }: {
  artifact: Artifact; state: State; start: () => void; className?: string;
}) {
  return (
    <button type="button" className={className} onClick={start} disabled={state.kind === "busy"} aria-label={`${state.kind === "error" ? "Retry download of" : "Download"} ${artifact.filename}`}>
      {state.kind === "busy" ? <><Loader2 size={16} className="spin" aria-hidden />Downloading…</> : <><Download size={16} aria-hidden />{state.kind === "error" ? "Retry download" : "Download"}</>}
    </button>
  );
}

export function DownloadStatus({ state }: { state: State }) {
  return (
    <>
      {state.kind === "done" && (
        <p className="small good" role="status"><CheckCircle2 size={14} aria-hidden /> Downloaded {state.name} ({formatBytes(state.size)}){state.checked ? ", checksum verified" : ""}.</p>
      )}
      {state.kind === "error" && (
        <p className="small bad" role="alert"><TriangleAlert size={14} aria-hidden /> {state.message}</p>
      )}
    </>
  );
}

export const artifactIcon = (artifact: Artifact) => (artifact.format === "pptx" ? Presentation : FileText);

export function FileCard({ artifact, revision, onPreview, previewing = false }: {
  artifact: Artifact; revision: number; onPreview?: (artifact: Artifact, opener: HTMLElement) => void; previewing?: boolean;
}) {
  const { state, start } = useArtifactDownload(artifact);
  const Icon = artifactIcon(artifact);
  const info = (
    <>
      <Icon size={28} aria-hidden className="file-icon" />
      <span className="file-info">
        <span className="file-name wrap-anywhere">{artifact.filename}</span>
        <span className="muted small block">{artifact.format.toUpperCase()} · {formatBytes(artifact.sizeBytes)} · revision {revision}{onPreview ? " · click to preview" : ""}</span>
      </span>
    </>
  );
  return (
    <div className={`file-card${previewing ? " file-card-active" : ""}`}>
      {onPreview ? (
        <button type="button" className="file-open" aria-label={`Preview ${artifact.filename}`} aria-expanded={previewing} onClick={(e) => onPreview(artifact, e.currentTarget)}>{info}</button>
      ) : <div className="file-open file-open-static">{info}</div>}
      <div className="file-actions">
        <DownloadStatus state={state} />
        <DownloadButton artifact={artifact} state={state} start={start} />
      </div>
    </div>
  );
}
