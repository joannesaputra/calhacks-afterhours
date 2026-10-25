"use client";
import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { emailDomain, hasWorkDomain, type SenderPolicy, type WorkspaceSettings } from "@afterhours/contracts";
import { describeError } from "@/lib/api";
import { isValidTimeZone } from "@/lib/format";
import { usePatchSettings } from "@/lib/hooks";
import { useDirty } from "../providers";
import { Field, SettingsSection, type SaveState } from "./section";
import { useDraft } from "./use-draft";

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function useSave() {
  const patch = usePatchSettings();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  return {
    state,
    run: (body: Parameters<typeof patch.mutate>[0], onDone?: () => void) => {
      setState({ kind: "saving" });
      patch.mutate(body, {
        onSuccess: () => { setState({ kind: "saved" }); onDone?.(); },
        onError: (e) => setState({ kind: "error", message: describeError(e) }),
      });
    },
    touch: () => setState((s) => (s.kind === "saved" || s.kind === "error" ? { kind: "idle" } : s)),
  };
}

// ---------------- Organization ----------------
export function OrganizationForm({ settings }: { settings: WorkspaceSettings }) {
  const org = settings.organization;
  const server = {
    name: org.name, description: org.description, timezone: org.timezone, currency: org.currency,
    backgroundText: org.backgroundText, policiesText: org.policiesText,
    primaryColor: org.brand.primaryColor, accentColor: org.brand.accentColor, fontFamily: org.brand.fontFamily,
  };
  const { draft, setDraft, dirty } = useDraft(server);
  const save = useSave();
  useDirty("organization", dirty);
  const set = (k: keyof typeof server) => (v: string) => { save.touch(); setDraft((d) => ({ ...d, [k]: v })); };

  const errors = {
    name: draft.name.trim() ? null : "Enter the organization name.",
    timezone: isValidTimeZone(draft.timezone) ? null : "Use an IANA timezone such as America/Los_Angeles.",
    currency: /^[A-Z]{3}$/.test(draft.currency) ? null : "Use a three-letter ISO code such as USD.",
    primaryColor: HEX.test(draft.primaryColor) ? null : "Use a hex color such as #14B8A6.",
    accentColor: HEX.test(draft.accentColor) ? null : "Use a hex color such as #0F766E.",
    fontFamily: draft.fontFamily.trim() ? null : "Enter a font family.",
  };
  const valid = Object.values(errors).every((e) => e === null);

  const colorField = (key: "primaryColor" | "accentColor", label: string) => (
    <Field id={`org-${key}`} label={label} error={errors[key]}>
      <div className="color-row">
        <input type="color" aria-label={`${label} picker`} value={HEX.test(draft[key]) ? draft[key] : "#000000"} onChange={(e) => set(key)(e.target.value)} />
        <input id={`org-${key}`} value={draft[key]} onChange={(e) => set(key)(e.target.value)} aria-invalid={errors[key] ? true : undefined} spellCheck={false} />
      </div>
    </Field>
  );

  return (
    <SettingsSection
      id="org" title="Organization" dirty={dirty} valid={valid} save={save.state}
      description="This profile is authorized context for preparing work: it can appear in the documents and slides. Each task keeps the profile it was created with, so saving here changes new requests only. Do not put secrets here."
      onSubmit={() =>
        save.run({
          organization: {
            name: draft.name.trim(), description: draft.description, timezone: draft.timezone.trim(), currency: draft.currency,
            backgroundText: draft.backgroundText, policiesText: draft.policiesText,
            brand: { primaryColor: draft.primaryColor, accentColor: draft.accentColor, fontFamily: draft.fontFamily.trim() },
          },
        })
      }
    >
      <Field id="org-name" label="Name" error={errors.name}><input id="org-name" value={draft.name} onChange={(e) => set("name")(e.target.value)} aria-invalid={errors.name ? true : undefined} /></Field>
      <Field id="org-description" label="Description"><textarea id="org-description" rows={2} value={draft.description} onChange={(e) => set("description")(e.target.value)} /></Field>
      <div className="grid-2">
        <Field id="org-timezone" label="Timezone" hint="Used for relative dates and for showing times." error={errors.timezone}>
          <input id="org-timezone" value={draft.timezone} onChange={(e) => set("timezone")(e.target.value)} aria-invalid={errors.timezone ? true : undefined} spellCheck={false} />
        </Field>
        <Field id="org-currency" label="Currency" error={errors.currency}>
          <input id="org-currency" value={draft.currency} maxLength={3} onChange={(e) => set("currency")(e.target.value.toUpperCase())} aria-invalid={errors.currency ? true : undefined} spellCheck={false} />
        </Field>
      </div>
      <Field id="org-background" label="Background"><textarea id="org-background" rows={4} value={draft.backgroundText} onChange={(e) => set("backgroundText")(e.target.value)} /></Field>
      <Field id="org-policies" label="Policies and pricing"><textarea id="org-policies" rows={4} value={draft.policiesText} onChange={(e) => set("policiesText")(e.target.value)} /></Field>
      <div className="grid-3">
        {colorField("primaryColor", "Primary color")}
        {colorField("accentColor", "Accent color")}
        <Field id="org-fontFamily" label="Font family" error={errors.fontFamily}><input id="org-fontFamily" value={draft.fontFamily} onChange={(e) => set("fontFamily")(e.target.value)} aria-invalid={errors.fontFamily ? true : undefined} /></Field>
      </div>
    </SettingsSection>
  );
}

// ---------------- Automation ----------------
const SENDER_POLICIES: { id: SenderPolicy; label: string; detail: (account: string | null) => string }[] = [
  { id: "approved", label: "Approved senders only", detail: () => "Only the exact addresses listed below can start work. This is the safest choice." },
  {
    id: "same_domain", label: "My work domain",
    detail: (account) => hasWorkDomain(account)
      ? `Anyone at @${emailDomain(account!)} can start work, plus the addresses listed below. Subdomains do not count.`
      : account
        ? `${account} is a personal mailbox, not a work domain, so only that one address counts as "same", plus the addresses listed below. Connect a work mailbox to include colleagues.`
        : "Connect Gmail first. Then anyone at the connected mailbox's work domain can start work, plus the addresses listed below.",
  },
  { id: "everyone", label: "Everyone", detail: () => "Any sender can start work. Newsletters, mailing lists and auto-replies are still skipped. Use this only on a mailbox you are happy to open to strangers." },
];

export function AutomationForm({ settings, account = null }: { settings: WorkspaceSettings; account?: string | null }) {
  const server = { automationEnabled: settings.automationEnabled, autoPrepare: settings.autoPrepare, senderPolicy: settings.senderPolicy, allowedSenders: settings.allowedSenders };
  const { draft, setDraft, dirty } = useDraft(server);
  const save = useSave();
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  useDirty("automation", dirty);

  function addSender() {
    const v = input.trim().toLowerCase();
    if (!v) return;
    if (!EMAIL.test(v)) { setInputError("Enter one full email address, such as client@example.com. Wildcards are not supported."); return; }
    if (draft.allowedSenders.includes(v)) { setInputError("That address is already on the list."); return; }
    if (draft.allowedSenders.length >= 50) { setInputError("The list is limited to 50 addresses."); return; }
    save.touch();
    setDraft((d) => ({ ...d, allowedSenders: [...d.allowedSenders, v] }));
    setInput("");
    setInputError(null);
  }

  return (
    <SettingsSection
      id="auto" title="Automation" dirty={dirty} save={save.state}
      description={draft.senderPolicy === "everyone"
        ? "Mail from any sender can start work. Listed addresses are always accepted."
        : draft.senderPolicy === "same_domain"
          ? "Mail from your work domain and from listed addresses can start work. Mail from anyone else is not processed."
          : "Only exact addresses on this list can start work automatically. Mail from anyone else is not processed."}
      onSubmit={() => save.run({ automationEnabled: draft.automationEnabled, autoPrepare: draft.autoPrepare, senderPolicy: draft.senderPolicy, allowedSenders: draft.allowedSenders })}
    >
      <label className="switch">
        <input type="checkbox" role="switch" checked={draft.automationEnabled} onChange={(e) => { save.touch(); setDraft((d) => ({ ...d, automationEnabled: e.target.checked })); }} />
        <span><strong>Automation enabled</strong><span className="muted small block">When off, Gmail is not checked. Approved senders’ messages that arrive meanwhile are picked up when you turn it back on.</span></span>
      </label>
      <label className="switch">
        <input type="checkbox" role="switch" checked={draft.autoPrepare} onChange={(e) => { save.touch(); setDraft((d) => ({ ...d, autoPrepare: e.target.checked })); }} />
        <span><strong>Prepare work automatically</strong><span className="muted small block">Start preparing as soon as an allowed sender’s request arrives. Preparing never sends anything. When off, those requests are skipped and are not kept to prepare later.</span></span>
      </label>
      <fieldset className="field" aria-describedby="sender-policy-hint">
        <legend>Who can start work</legend>
        <p className="muted small" id="sender-policy-hint">Choose whose email AfterHours may turn into work. Everything it prepares is still a draft for you to review.</p>
        <div role="radiogroup" aria-label="Who can start work" className="stack-sm">
          {SENDER_POLICIES.map((o) => (
            <label key={o.id} className="card card-flat option" htmlFor={`policy-${o.id}`}>
              <span>
                <input
                  type="radio" id={`policy-${o.id}`} name="sender-policy" value={o.id} checked={draft.senderPolicy === o.id}
                  onChange={() => { save.touch(); setDraft((d) => ({ ...d, senderPolicy: o.id })); }}
                /> <strong>{o.label}</strong>
              </span>
              <span className="muted small wrap-anywhere">{o.detail(account)}</span>
            </label>
          ))}
        </div>
        {draft.senderPolicy === "everyone" && (
          <p className="callout callout-warn" role="note"><AlertTriangle size={16} aria-hidden /> Anyone who emails this mailbox can start a task, which may use your model quota and read attachments they send. Mail is still treated as data, never as instructions, and nothing is sent without your review.</p>
        )}
      </fieldset>
      <Field id="sender-input" label={draft.senderPolicy === "approved" ? "Approved senders" : "Always-approved senders"} error={inputError} hint="Exact addresses only. They are lower-cased and accepted in every mode.">
        <div className="add-row">
          <input
            id="sender-input" type="email" inputMode="email" autoComplete="off" value={input} placeholder="client@example.com"
            onChange={(e) => { setInput(e.target.value); setInputError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSender(); } }}
            aria-invalid={inputError ? true : undefined}
          />
          <button type="button" className="btn btn-secondary" onClick={addSender}>Add</button>
        </div>
      </Field>
      {draft.allowedSenders.length === 0 ? (
        <p className="callout callout-info">{draft.senderPolicy === "approved" ? "No approved senders. Nothing will be prepared automatically until you add one." : "No addresses listed. Senders are accepted by the choice above."}</p>
      ) : (
        <ul className="chips-list" aria-label="Approved senders">
          {draft.allowedSenders.map((s) => (
            <li key={s} className="chip-removable">
              <span className="wrap-anywhere">{s}</span>
              <button type="button" className="icon-btn" aria-label={`Remove ${s}`} onClick={() => { save.touch(); setDraft((d) => ({ ...d, allowedSenders: d.allowedSenders.filter((x) => x !== s) })); }}>
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

// ---------------- Notifications ----------------
export function NotificationsForm({ settings, eligible, configured, lastError }: {
  settings: WorkspaceSettings; eligible: boolean | undefined; configured: boolean | undefined; lastError: string | null | undefined;
}) {
  const n = settings.notifications;
  const server = {
    channel: n.channel, recipient: n.recipient ?? "", quietEnabled: n.quietHours.enabled, quietStart: n.quietHours.start,
    quietEnd: n.quietHours.end, quietTz: n.quietHours.timezone, digestTime: n.digestTime,
  };
  const { draft, setDraft, dirty } = useDraft(server);
  const save = useSave();
  useDirty("notifications", dirty);
  const set = <K extends keyof typeof server>(k: K, v: (typeof server)[K]) => { save.touch(); setDraft((d) => ({ ...d, [k]: v })); };

  const errors = {
    recipient: draft.channel === "whatsapp" && draft.recipient.trim() && !/^\+[1-9]\d{6,14}$/.test(draft.recipient.trim().replace(/[\s().-]/g, "")) ? "Use an international number such as +15551234567." : null,
    quietStart: HHMM.test(draft.quietStart) ? null : "Use a time like 22:00.",
    quietEnd: HHMM.test(draft.quietEnd) ? null : "Use a time like 07:00.",
    quietTz: isValidTimeZone(draft.quietTz) ? null : "Use an IANA timezone such as America/Los_Angeles.",
    digestTime: HHMM.test(draft.digestTime) ? null : "Use a time like 08:00.",
  };
  const valid = Object.values(errors).every((e) => e === null);

  return (
    <SettingsSection
      id="notif" title="Notifications" dirty={dirty} valid={valid} save={save.state}
      description="Work is always prepared immediately. These settings only control when and how you are told about it."
      onSubmit={() =>
        save.run({
          notifications: {
            channel: draft.channel,
            recipient: draft.recipient.trim() ? draft.recipient.trim() : null,
            quietHours: { enabled: draft.quietEnabled, start: draft.quietStart, end: draft.quietEnd, timezone: draft.quietTz },
            digestTime: draft.digestTime,
          },
        })
      }
    >
      <Field id="notif-channel" label="Channel">
        <select id="notif-channel" value={draft.channel} onChange={(e) => set("channel", e.target.value as "outbox" | "whatsapp")}>
          <option value="outbox">Outbox (simulated, nothing is sent)</option>
          <option value="whatsapp">WhatsApp (official API, if eligible)</option>
        </select>
      </Field>
      <div className="callout callout-info" role="note">
        <div>
          <strong>Live WhatsApp status (set by the server operator)</strong>
          <ul>
            <li>Use case confirmed eligible: {eligible === undefined ? "checking…" : eligible ? "yes" : "no"}</li>
            <li>Provider configured: {configured === undefined ? "checking…" : configured ? "yes" : "no"}</li>
          </ul>
          {eligible === false && <p>Live WhatsApp is off because the operator has not confirmed this use case is permitted (the WHATSAPP_USE_CASE_ELIGIBLE server setting). Messages for WhatsApp are blocked and recorded; the results stay in your queue, and outbox mode keeps working.</p>}
          {lastError && <p className="bad">Last delivery error: {lastError}</p>}
        </div>
      </div>
      <Field id="notif-recipient" label="Recipient" hint="Phone number in international format. Only used for WhatsApp." error={errors.recipient}>
        <input id="notif-recipient" type="tel" autoComplete="off" value={draft.recipient} onChange={(e) => set("recipient", e.target.value)} placeholder="+15551234567" aria-invalid={errors.recipient ? true : undefined} />
      </Field>
      <label className="switch">
        <input type="checkbox" role="switch" checked={draft.quietEnabled} onChange={(e) => set("quietEnabled", e.target.checked)} />
        <span><strong>Quiet hours</strong><span className="muted small block">Delay notifications overnight. Work continues; results wait for you in the queue and arrive as one morning digest.</span></span>
      </label>
      <div className="grid-3">
        <Field id="notif-qstart" label="Quiet from" error={errors.quietStart}><input id="notif-qstart" type="time" value={draft.quietStart} onChange={(e) => set("quietStart", e.target.value)} disabled={!draft.quietEnabled} /></Field>
        <Field id="notif-qend" label="Quiet until" error={errors.quietEnd}><input id="notif-qend" type="time" value={draft.quietEnd} onChange={(e) => set("quietEnd", e.target.value)} disabled={!draft.quietEnabled} /></Field>
        <Field id="notif-qtz" label="Quiet-hours timezone" error={errors.quietTz}><input id="notif-qtz" value={draft.quietTz} onChange={(e) => set("quietTz", e.target.value)} disabled={!draft.quietEnabled} spellCheck={false} /></Field>
      </div>
      <Field id="notif-digest" label="Morning digest time" hint="Local time. Results held during quiet hours are summarized at this time." error={errors.digestTime}>
        <input id="notif-digest" type="time" value={draft.digestTime} onChange={(e) => set("digestTime", e.target.value)} />
      </Field>
    </SettingsSection>
  );
}
