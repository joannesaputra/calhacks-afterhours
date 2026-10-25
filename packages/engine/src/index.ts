import type {
  BinaryAttachment, EngineDependencies, EngineInput, EngineProgress, EngineResult, GeneratedFile,
} from "@afterhours/contracts";
import { execute, type EngineOptions } from "./pipeline";

export type { BinaryAttachment, EngineDependencies, EngineInput, EngineProgress, EngineResult, GeneratedFile };
export { calculateSales, type SalesMetrics, type SalesRow } from "./calculations";
export { resolveDeadline } from "./dates";
export { EngineError } from "./errors";
export { MODEL_LIMITS, type CallRecord, type ModelClient, type ModelLimits, type ModelRequest, type ModelResponse } from "./providers/model";
export type { EngineOptions };

export async function runWork(input: EngineInput, deps: EngineDependencies): Promise<EngineResult> {
  return execute(input, deps);
}

/**
 * Test factory: same pipeline as runWork with an injected model client, call limits, or clock.
 * Lets platform drills exercise live-mode timeouts, transient failures, and cancellation without
 * paid provider calls. It grants no database, file, or network privileges beyond the client given.
 */
export function createEngine(options: EngineOptions): { runWork: typeof runWork } {
  return { runWork: (input, deps) => execute(input, deps, options) };
}
export { extractDocument, PARSER_VERSION, type ExtractInput, type ExtractOutcome, type ExtractedUnit } from "./ooxml/extract";
export { applyDeckEdits, readDeckBytes, listSlides, type DeckEditInput, type DeckEditResult, type SlideText } from "./ooxml/deck";
export { OoxmlError, readPackage } from "./ooxml/zip";
