"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import { AutomationForm, NotificationsForm, OrganizationForm } from "@/components/settings/forms";
import { GmailSection, ModelAndWorkerSection } from "@/components/settings/connections";
import { ContextAccessSection } from "@/components/settings/context-access";
import { useShell } from "@/components/shell";
import { ErrorPanel, SkeletonCards } from "@/components/states";
import { useSettings } from "@/lib/hooks";

const GMAIL_REASONS: Record<string, string> = {
  invalid_state: "The connection attempt was not valid. Start again from this page.",
  expired: "The connection attempt expired. Start again from this page.",
  session: "Your session changed while connecting. Sign in again, then retry.",
  denied: "Google access was declined, so Gmail was not connected.",
  no_refresh_token: "Google did not return a long-lived token. Remove AfterHours at myaccount.google.com/permissions, then connect again.",
  exchange_failed: "Google could not complete the connection. Try again; if it keeps failing, the operator should check that the Gmail API is enabled in the Google Cloud project and that the client ID and secret are correct.",
  not_configured: "Gmail is not set up on the server (Google client credentials are missing). The operator must add them.",
  redirect_mismatch: "The server's Google redirect address does not match this app's address, so the connection was refused. The operator must fix GOOGLE_REDIRECT_URI.",
  scope: "Google did not grant read access to the mailbox, so nothing was connected. Try again and accept the read-only permission.",
};

export function SettingsView() {
  const settings = useSettings();
  const { integrations } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Show the OAuth callback marker once, then remove it from the URL so a refresh does not repeat it.
  useEffect(() => {
    const marker = params.get("gmail");
    if (!marker) return;
    if (marker === "connected") {
      const send = params.get("send") === "1";
      setNotice({ ok: true, text: send ? "Gmail connected, and sending replies is allowed. New messages from allowed senders will be prepared; nothing is sent unless you click Send on a reviewed task." : "Gmail connected. New messages from allowed senders will be prepared." });
    }
    else {
      const reason = params.get("reason") ?? "";
      setNotice({ ok: false, text: GMAIL_REASONS[reason] ?? "Gmail could not be connected. Try again." });
    }
    router.replace(pathname);
  }, [params, pathname, router]);

  const tz = settings.data?.organization.timezone;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Everything here is saved on the server and survives a refresh. Credentials are set in the server environment, not in the browser.</p>
        </div>
      </div>
      {notice && (
        <div className={`banner ${notice.ok ? "banner-good" : "banner-warn"}`} role={notice.ok ? "status" : "alert"}>
          {notice.ok ? <CheckCircle2 size={18} aria-hidden /> : <TriangleAlert size={18} aria-hidden />}
          <div className="grow">{notice.text}</div>
          <button type="button" className="icon-btn" aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={16} aria-hidden /></button>
        </div>
      )}
      {settings.isPending && <SkeletonCards />}
      {settings.isError && <ErrorPanel error={settings.error} title="Could not load settings" onRetry={() => void settings.refetch()} />}
      <div className="stack">
        {settings.data && <OrganizationForm settings={settings.data} />}
        {settings.data && <AutomationForm settings={settings.data} account={integrations?.gmail.email ?? null} />}
        <GmailSection status={integrations?.gmail} timeZone={tz} />
        <ContextAccessSection timeZone={tz} />
        <ModelAndWorkerSection status={integrations} timeZone={tz} />
        {settings.data && (
          <NotificationsForm
            settings={settings.data}
            eligible={integrations?.notifications.eligible}
            configured={integrations?.notifications.configured}
            lastError={integrations?.notifications.lastError}
          />
        )}
      </div>
    </>
  );
}
