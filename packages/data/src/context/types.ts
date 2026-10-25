import type { ExtractedUnit, RetrievalFailureClass } from "./extractTypes";

/** The single workspace owner. Every context table carries it and every query filters on it. */
export const OWNER_ID = "workspace";

export type FileProviderId = "gmail" | "folder" | "drive" | "task";
export type { RetrievalFailureClass, ExtractedUnit };
