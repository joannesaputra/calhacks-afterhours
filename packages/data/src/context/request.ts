// Stage A: parse the incoming request. Evidence (literal text found) is kept apart from inference (what it probably means).
import { extractRequirements, type ExtractedRequirement } from "./requirements";
import { findDatePhrases } from "./temporal";
import { extractLinkRefs, extractUrlHosts, projectTerms, splitBody, type LinkRef } from "./text";

export interface ParsedRequest {
  evidence: {
    subject: string;
    freshText: string;
    forwardedText: string;
    urlHosts: string[];
    linkRefs: LinkRef[];
    filenames: string[];
    datePhrases: string[];
    editLines: ExtractedRequirement[];
    injectionFlagged: number;
  };
  inferred: {
    action: "revise" | "create" | "other";
    deliverable: "presentation" | "document" | "unknown";
    projectTerms: string[];
    /** terms from a named project in the body (not the subject line): only these may count against a candidate */
    explicitProjectTerms: string[];
    refersToPriorMaterial: boolean;
    refersToPriorDiscussion: boolean;
    /** The request asks to change something that already exists. Only then is context retrieval run. */
    applicable: boolean;
    reasons: string[];
  };
}

const REVISE = /\b(?:revis(?:e|ing)|updat(?:e|ing)|edit(?:ing)?|rework(?:ing)?|redo|tweak(?:ing)?|modify(?:ing)?|amend(?:ing)?|polish(?:ing)?|refresh(?:ing)?|apply(?:ing)?\s+(?:the\s+)?(?:feedback|changes|edits|comments)|incorporat(?:e|ing)|fix(?:ing)?)\b/i;
const CREATE = /\b(?:prepare|create|draft|build|make|write|put together|generate|produce)\s+(?:a|an|the|me)?\b/i;
const SUBJECT_COMMAND = /^\s*(?:(?:re|fwd?)\s*:\s*)*(?:please\s+)?(?:revise|update|edit|rework|redo|tweak|modify|amend|polish|refresh|fix)\b/i;
const DECK = /\b(?:deck|presentation|slides?|slide deck|pptx|powerpoint|pitch)\b/i;
const DOC = /\b(?:document|proposal|report|docx|memo|contract)\b/i;
const PRIOR_MATERIAL = /\b(?:from|of|sent|shared|presented|made|reviewed|prepared)\s+(?:last|on|the|earlier|before|yesterday)\b|\b(?:previous|earlier|existing|original|latest|current)\s+(?:version|deck|presentation|draft)\b|\blast\s+(?:week|month|time)\b|\b(?:we|you|i)\s+(?:sent|shared|presented|made|reviewed|prepared)\b|\bthe\s+(?:deck|presentation)\s+(?:from|we|you|i)\b/i;
const PRIOR_DISCUSSION = /\b(?:what\s+we\s+(?:discussed|talked\s+about|agreed|covered)|as\s+(?:we\s+)?discussed|per\s+(?:our|the)\s+(?:call|chat|conversation|meeting|discussion|feedback)|our\s+(?:call|chat|conversation|meeting|discussion)|from\s+(?:our|the)\s+(?:call|meeting)|based\s+on\s+(?:the\s+)?(?:feedback|comments|notes|discussion)|the\s+feedback|their\s+(?:comments|feedback|notes))\b/i;
const FILENAME = /\b([\w][\w .()-]{0,80}\.(?:pptx|ppt|key|pdf|docx))\b/gi;

export function parseRequest(email: { subject: string; bodyText: string }): ParsedRequest {
  const split = splitBody(email.bodyText);
  const fresh = split.fresh;
  const all = `${email.subject}\n${fresh}`;
  const extraction = extractRequirements(fresh, {});
  const filenames = [...new Set([...all.matchAll(FILENAME)].map((m) => m[1]!.trim()))];
  const deck = DECK.test(all);
  const doc = DOC.test(all);
  // A revise verb must be in what the sender wrote, or lead the subject as a command. "five-slide update" in a subject
  // that asks to "prepare" something new is a noun, not a request to change an existing deck.
  const create = CREATE.test(fresh);
  const revise = REVISE.test(fresh) || (!create && SUBJECT_COMMAND.test(email.subject));
  const pt = projectTerms(email.subject, fresh);
  const reasons: string[] = [];
  const action: ParsedRequest["inferred"]["action"] = revise && (deck || doc) ? "revise" : create ? "create" : "other";
  const deliverable: ParsedRequest["inferred"]["deliverable"] = deck ? "presentation" : doc ? "document" : "unknown";
  const refersToPriorMaterial = PRIOR_MATERIAL.test(all);
  const refersToPriorDiscussion = PRIOR_DISCUSSION.test(all);
  if (action === "revise") reasons.push("revise_verb_with_deliverable");
  if (refersToPriorMaterial) reasons.push("refers_to_earlier_material");
  if (refersToPriorDiscussion) reasons.push("refers_to_earlier_discussion");
  if (filenames.length) reasons.push("names_a_file");
  // "Prepare a proposal and a deck from the attached brief" creates something new; it is never a revision request.
  const applicable = action === "revise" && deliverable === "presentation";
  return {
    evidence: {
      subject: email.subject, freshText: fresh, forwardedText: split.forwarded,
      urlHosts: extractUrlHosts(`${fresh}\n${split.forwarded}`), linkRefs: extractLinkRefs(`${fresh}\n${split.forwarded}`),
      filenames, datePhrases: findDatePhrases(all), editLines: extraction.requirements, injectionFlagged: extraction.flagged,
    },
    inferred: { action, deliverable, projectTerms: pt.all, explicitProjectTerms: pt.explicit, refersToPriorMaterial, refersToPriorDiscussion, applicable, reasons },
  };
}
