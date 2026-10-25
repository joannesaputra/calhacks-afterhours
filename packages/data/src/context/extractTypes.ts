// Parser contract. The engine's extractDocument() satisfies it structurally; data never imports the engine at runtime.
export type { RetrievalFailureClass } from "@afterhours/contracts";

export interface ExtractedUnit { unit: number | null; unitKind: "slide" | "page" | "section" | null; locator: string; section: string | null; text: string }

export type ExtractOutcome =
  | { status: "complete"; units: ExtractedUnit[]; parserVersion: string; truncated: boolean; detail: string | null }
  | { status: "unsupported" | "encrypted" | "oversized" | "failed"; detail: string; parserVersion: string };

export interface ExtractInput { bytes: Uint8Array; filename: string; mimeType: string; maxBytes: number; maxUnits: number }
export type Extractor = (input: ExtractInput) => ExtractOutcome;
