import { emailDomain, hasWorkDomain, type WorkspaceSettings } from "@afterhours/contracts";

export type SenderDecision = "listed" | "same_domain" | "everyone" | "no";

/**
 * Decide whether a sender may start work. Pure; addresses are compared lower-cased and exactly (no subdomains, no
 * wildcards). Listed addresses are accepted in every mode. `listed` means the person was approved by name, so callers
 * can keep the stricter checks for the broader modes (automated mail) off exact approvals.
 */
export function decideSender(
  settings: Pick<WorkspaceSettings, "senderPolicy" | "allowedSenders">,
  senderEmail: string,
  connectedAccount: string | null | undefined,
): SenderDecision {
  const sender = senderEmail.trim().toLowerCase();
  if (!sender.includes("@")) return "no";
  if (settings.allowedSenders.some((a) => a.trim().toLowerCase() === sender)) return "listed";
  if (settings.senderPolicy === "everyone") return "everyone";
  if (settings.senderPolicy === "same_domain") {
    const account = (connectedAccount ?? "").trim().toLowerCase();
    if (!account.includes("@")) return "no";
    if (sender === account) return "same_domain";
    if (hasWorkDomain(account) && emailDomain(sender) === emailDomain(account)) return "same_domain";
  }
  return "no";
}

/** Local parts that identify a machine sender rather than a person. */
const AUTOMATED_LOCAL = /^(?:no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|newsletter)(?:[+._-].*)?$/i;

/**
 * Bulk and automatic mail: mailing lists, newsletters, auto-replies and no-reply senders. Used only for senders that
 * were not approved by name, so an explicitly listed address keeps working whatever its headers say.
 */
export function looksAutomated(senderEmail: string, header: (name: string) => string | undefined): boolean {
  const local = senderEmail.slice(0, senderEmail.lastIndexOf("@"));
  if (AUTOMATED_LOCAL.test(local)) return true;
  if (header("list-id") || header("list-unsubscribe")) return true;
  const auto = header("auto-submitted");
  if (auto && !/^\s*no\b/i.test(auto)) return true;
  if (/\b(bulk|list|junk)\b/i.test(header("precedence") ?? "")) return true;
  return false;
}
