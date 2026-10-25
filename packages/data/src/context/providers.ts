import { existsSync, statSync } from "node:fs";
import type { AppConfig } from "../config";
import { createLocalFolderProvider, createUnavailableDriveProvider, type FileProvider } from "./files";

export interface ProviderStatus { provider: string; available: boolean; scopeNote: string; limitation: string | null }

/** File sources this installation can offer. Drive is always reported, and always as unavailable in this release. */
export function buildFileProviders(config: Pick<AppConfig, "context">): Partial<Record<"folder" | "drive", FileProvider>> {
  const out: Partial<Record<"folder" | "drive", FileProvider>> = { drive: createUnavailableDriveProvider() };
  const root = config.context.filesRoot;
  if (root && existsSync(root) && statSync(root).isDirectory()) out.folder = createLocalFolderProvider(root);
  return out;
}

export function describeProviders(config: Pick<AppConfig, "context">): ProviderStatus[] {
  const files = buildFileProviders(config);
  return [
    {
      provider: "gmail", available: true,
      scopeNote: "Gmail access is read-only (gmail.readonly) but covers the whole mailbox: Google cannot limit it to a lookback window. Afterhours itself stores only messages inside your lookback and uses only those. This is an app-level limit, not a Google one.",
      limitation: null,
    },
    {
      provider: "folder", available: !!files.folder,
      scopeNote: files.folder?.scopeNote ?? "A local project folder is enforced by Afterhours on the host, not by the operating system.",
      limitation: files.folder ? null : "No local folder source is configured. The operator must set CONTEXT_FILES_ROOT to a directory the app may read from.",
    },
    { provider: "drive", available: false, scopeNote: files.drive!.scopeNote, limitation: files.drive!.limitation },
  ];
}
