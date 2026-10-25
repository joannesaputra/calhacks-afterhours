"use client";
import { useId, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import type { SlideContent, SourceDocument, SourceRef, WorkProduct } from "@afterhours/contracts";
import { PreviewContext } from "./context";
import { BlockView } from "./blocks";
import { SourceDialog } from "./source-dialog";

export const KIND_LABEL = { proposal: "Proposal", report: "Report", presentation: "Presentation", document: "Document" } as const;

function DocumentPage({ product }: { product: WorkProduct }) {
  return (
    <article className="doc-page" aria-label={`${product.title} document preview`}>
      <h3 className="doc-title">{product.title}</h3>
      {product.subtitle && <p className="doc-subtitle">{product.subtitle}</p>}
      {product.blocks.map((b) => <BlockView key={b.id} block={b} />)}
    </article>
  );
}

function SlideCard({ slide, index, total }: { slide: SlideContent; index: number; total: number }) {
  const half = Math.ceil(slide.blocks.length / 2);
  return (
    <div className={`slide slide-${slide.layout}${slide.layout === "title" ? " slide-title-layout" : ""}`} role="group" aria-label={`Slide ${index + 1} of ${total}: ${slide.title}`}>
      <h4 className="slide-title">{slide.title}</h4>
      {slide.layout === "two_column" ? (
        <div className="slide-cols">
          <div>{slide.blocks.slice(0, half).map((b) => <BlockView key={b.id} block={b} compact />)}</div>
          <div>{slide.blocks.slice(half).map((b) => <BlockView key={b.id} block={b} compact />)}</div>
        </div>
      ) : (
        <div className="slide-body">{slide.blocks.map((b) => <BlockView key={b.id} block={b} compact />)}</div>
      )}
    </div>
  );
}

function SlideDeck({ product }: { product: WorkProduct }) {
  const [index, setIndex] = useState(0);
  const slides = product.slides;
  const i = Math.min(index, slides.length - 1);
  const slide = slides[i];
  if (!slide) return null;
  return (
    <div className="deck" aria-label={`${product.title} slides preview`}>
      <div className="deck-nav">
        <button type="button" className="icon-btn" aria-label="Previous slide" disabled={i === 0} onClick={() => setIndex(i - 1)}><ChevronLeft size={18} aria-hidden /></button>
        <span className="small" aria-live="polite">Slide {i + 1} of {slides.length}</span>
        <button type="button" className="icon-btn" aria-label="Next slide" disabled={i === slides.length - 1} onClick={() => setIndex(i + 1)}><ChevronRight size={18} aria-hidden /></button>
      </div>
      <ol className="thumbs" aria-label="Slides">
        {slides.map((s, n) => (
          <li key={s.id}>
            <button type="button" className="thumb" aria-current={n === i ? "true" : undefined} onClick={() => setIndex(n)}>
              <span className="thumb-num">{n + 1}</span>
              <span className="thumb-title">{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <SlideCard slide={slide} index={i} total={slides.length} />
      {slide.speakerNotes && (
        <details className="notes"><summary>Speaker notes</summary><p>{slide.speakerNotes}</p></details>
      )}
    </div>
  );
}

export function ProductBody({ product }: { product: WorkProduct }) {
  return (
    <div>
      {product.warnings.length > 0 && (
        <div className="callout callout-warn" role="note">
          <AlertTriangle size={16} aria-hidden />
          <div><strong>Warnings</strong><ul>{product.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
        </div>
      )}
      {product.blocks.length > 0 && <DocumentPage product={product} />}
      {product.slides.length > 0 && <SlideDeck product={product} />}
      {product.assumptions.length > 0 && (
        <div className="callout callout-info">
          <div><strong>Assumptions and unknowns</strong><ul>{product.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
        </div>
      )}
    </div>
  );
}

/** Semantic "Content preview" of the same WorkProduct that produced the file. Not a Word/PowerPoint renderer. */
export function ProductPreview({ products, sources }: { products: WorkProduct[]; sources: SourceDocument[] }) {
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<{ ref: SourceRef; opener: HTMLElement | null } | null>(null);
  const baseId = useId();
  const idx = Math.min(active, products.length - 1);
  const product = products[idx];
  if (!product) return null;
  return (
    <PreviewContext.Provider value={{ sources, openSource: (ref, opener) => setSelected({ ref, opener }) }}>
      <section className="preview" aria-labelledby={`${baseId}-h`}>
        <div className="preview-head">
          <h2 id={`${baseId}-h`} className="h3"><Eye size={18} aria-hidden /> Content preview</h2>
          <p className="muted small">A structured view of the same content used to build the files. It is not a pixel-accurate Word or PowerPoint rendering. Download the files for the real documents.</p>
        </div>
        {products.length > 1 && (
          <div role="tablist" aria-label="Products" className="tabs">
            {products.map((p, n) => (
              <button
                key={p.id} type="button" role="tab" id={`${baseId}-t${n}`} className="tab"
                aria-selected={n === idx} aria-controls={`${baseId}-p`} tabIndex={n === idx ? 0 : -1}
                onClick={() => setActive(n)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") setActive((idx + 1) % products.length);
                  if (e.key === "ArrowLeft") setActive((idx - 1 + products.length) % products.length);
                }}
              >
                {KIND_LABEL[p.kind]}: {p.title}
              </button>
            ))}
          </div>
        )}
        <div id={`${baseId}-p`} role={products.length > 1 ? "tabpanel" : undefined} aria-labelledby={products.length > 1 ? `${baseId}-t${idx}` : undefined}>
          <ProductBody product={product} />
        </div>
      </section>
      {selected && (
        <SourceDialog
          reference={selected.ref}
          source={sources.find((s) => s.id === selected.ref.sourceId)}
          opener={selected.opener}
          onClose={() => setSelected(null)}
        />
      )}
    </PreviewContext.Provider>
  );
}
