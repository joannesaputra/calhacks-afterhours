"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, X } from "lucide-react";
import type { Artifact, SourceDocument, SourceRef, WorkProduct } from "@afterhours/contracts";
import { DownloadButton, DownloadStatus, artifactIcon, useArtifactDownload } from "../files";
import { formatBytes } from "@/lib/format";
import { PreviewContext } from "./context";
import { ProductBody } from "./product-preview";
import { SourceDialog } from "./source-dialog";

/**
 * Side panel that opens the content of one prepared file next to the task, before it is downloaded. It shows the
 * same structured content the file was built from (not a Word or PowerPoint rendering) and says so.
 */
export function FileDrawer({ artifact, product, sources, opener, onClose }: {
  artifact: Artifact; product: WorkProduct | undefined; sources: SourceDocument[]; opener: HTMLElement | null; onClose: () => void;
}) {
  const { state, start } = useArtifactDownload(artifact);
  const [selected, setSelected] = useState<{ ref: SourceRef; opener: HTMLElement | null } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const Icon = artifactIcon(artifact);

  useEffect(() => {
    closeRef.current?.focus();
    document.body.classList.add("drawer-open");
    return () => {
      document.body.classList.remove("drawer-open");
      opener?.focus();
    };
  }, [opener]);

  // Escape closes the panel unless the source dialog on top of it is open (the dialog handles its own Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !selected) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, selected]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden />
      <aside className="drawer" role="complementary" aria-labelledby="drawer-title" data-testid="file-drawer">
        <header className="drawer-head">
          <Icon size={22} aria-hidden className="file-icon" />
          <div className="grow">
            <h2 id="drawer-title" className="h3 wrap-anywhere">{artifact.filename}</h2>
            <p className="muted small">{artifact.format.toUpperCase()} · {formatBytes(artifact.sizeBytes)} · revision {artifact.revision}</p>
          </div>
          <DownloadButton artifact={artifact} state={state} start={start} className="btn btn-primary" />
          <button type="button" ref={closeRef} className="icon-btn" aria-label="Close preview" onClick={onClose}><X size={18} aria-hidden /></button>
        </header>
        <div className="drawer-note muted small"><Eye size={14} aria-hidden /> A structured view of the content this file was built from. It is not a pixel-accurate Word or PowerPoint rendering; download the file for the real document.</div>
        <DownloadStatus state={state} />
        <div className="drawer-body">
          {product ? (
            <PreviewContext.Provider value={{ sources, openSource: (ref, o) => setSelected({ ref, opener: o }) }}>
              <ProductBody product={product} />
            </PreviewContext.Provider>
          ) : (
            <p className="callout callout-warn" role="note">No content preview is recorded for this file. Download it to open the real document.</p>
          )}
        </div>
      </aside>
      {selected && (
        <SourceDialog reference={selected.ref} source={sources.find((s) => s.id === selected.ref.sourceId)} opener={selected.opener} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
