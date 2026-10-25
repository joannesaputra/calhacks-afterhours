/** Every retrieval stage draws from one budget. Hitting a limit never reads as "nothing exists": it is reported. */
export interface ContextLimits {
  maxQueries: number;
  maxMessages: number;
  maxFiles: number;
  maxBytes: number;
  /** largest single file that will be fetched and parsed */
  maxFileBytes: number;
  /** pages or slides extracted */
  maxUnits: number;
  maxMs: number;
  /** model tokens the engine may spend on this request (0: the revision path calls no model) */
  maxModelTokens: number;
  /** most rows the no-FTS fallback will scan per search */
  scanCap: number;
  /** most messages one sync step stores */
  syncMessagesPerStep: number;
  syncPageSize: number;
}

export const DEFAULT_LIMITS: ContextLimits = {
  maxQueries: 16,
  maxMessages: 80,
  maxFiles: 8,
  maxBytes: 40 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxUnits: 160,
  maxMs: 20_000,
  maxModelTokens: 0,
  scanCap: 3_000,
  syncMessagesPerStep: 25,
  syncPageSize: 25,
};

export interface RankWeights {
  explicit_file_reference: number;
  link_file_id_match: number;
  user_confirmation: number;
  thread_linkage: number;
  project_match: number;
  sender_relevance: number;
  temporal_fit: number;
  file_type_match: number;
  documented_feedback: number;
  version_lineage: number;
  selected_folder_member: number;
  different_project: number;
  outside_interval: number;
}

export interface Thresholds {
  /** A target needs at least this score. */
  minTargetScore: number;
  /** The best target must beat the next different one by this much, or the user is asked. */
  minMargin: number;
  weights: RankWeights;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minTargetScore: 30,
  minMargin: 12,
  weights: {
    explicit_file_reference: 40, link_file_id_match: 40, user_confirmation: 50, thread_linkage: 25, project_match: 15,
    sender_relevance: 10, temporal_fit: 15, file_type_match: 10, documented_feedback: 10, version_lineage: 8,
    selected_folder_member: 5, different_project: -25, outside_interval: -10,
  },
};

export class ContextCancelled extends Error {
  readonly code = "CONTEXT_CANCELLED";
  readonly retryable = true;
  constructor() { super("Context retrieval was cancelled."); this.name = "ContextCancelled"; }
}

export interface Counters { queries: number; messages: number; files: number; bytes: number; units: number }

export class Budget {
  readonly counters: Counters = { queries: 0, messages: 0, files: 0, bytes: 0, units: 0 };
  readonly hit = new Set<string>();
  cacheHits = 0;
  filesParsed = 0;
  private readonly t0: number;
  constructor(readonly limits: ContextLimits, private readonly clock: () => number = Date.now, private readonly signal?: AbortSignal) {
    this.t0 = clock();
  }
  elapsedMs(): number { return this.clock() - this.t0; }
  checkCancelled(): void { if (this.signal?.aborted) throw new ContextCancelled(); }
  timeUp(): boolean {
    this.checkCancelled();
    if (this.elapsedMs() > this.limits.maxMs) { this.hit.add("time"); return true; }
    return false;
  }
  /** Reserve `n` of a resource. Returns false (and records the limit) when it would be exceeded. */
  take(kind: keyof Counters, n = 1): boolean {
    this.checkCancelled();
    const cap = { queries: this.limits.maxQueries, messages: this.limits.maxMessages, files: this.limits.maxFiles, bytes: this.limits.maxBytes, units: this.limits.maxUnits }[kind];
    if (this.counters[kind] + n > cap) { this.hit.add(kind); return false; }
    this.counters[kind] += n;
    return true;
  }
  remaining(kind: keyof Counters): number {
    const cap = { queries: this.limits.maxQueries, messages: this.limits.maxMessages, files: this.limits.maxFiles, bytes: this.limits.maxBytes, units: this.limits.maxUnits }[kind];
    return Math.max(0, cap - this.counters[kind]);
  }
}
