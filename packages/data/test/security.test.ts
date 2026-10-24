import { describe, expect, it } from "vitest";
import {
  consumeOauthState, createOauthState, createSession, decryptSecret, disconnectGmail, encryptSecret,
  getGmailTokens, getIntegrationStatus, lookupSession, patchSettings, revokeSession, saveGmailConnection,
  updateGmailTokens, resolveArtifactPath, DomainError, getGmailRow,
} from "../src";
import { makeTestDb, runToReady } from "../src/testing";
import { symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const key = Buffer.alloc(32, 9);
const T = new Date("2026-03-02T20:00:00Z");
const later = (s: number) => new Date(T.getTime() + s * 1000);

describe("token encryption", () => {
  it("round-trips and rejects tampering or a wrong key", () => {
    const enc = encryptSecret(key, "refresh-token-value");
    expect(enc).not.toContain("refresh-token-value");
    expect(decryptSecret(key, enc)).toBe("refresh-token-value");
    const parts = enc.split(".");
    const ct = Buffer.from(parts[3]!, "base64url"); ct[0] = ct[0]! ^ 1;
    expect(() => decryptSecret(key, [parts[0], parts[1], parts[2], ct.toString("base64url")].join("."))).toThrow();
    expect(() => decryptSecret(Buffer.alloc(32, 1), enc)).toThrow();
  });

  it("keeps the refresh token when a refresh response omits it; never exposes tokens in status DTOs", () => {
    const { db, config } = makeTestDb();
    saveGmailConnection(db, config.tokenEncryptionKey, { account: "inbox@test.dev", tokens: { access_token: "ACCESS-ONE-xyz", refresh_token: "REFRESH-ONE-xyz" } }, T);
    const conn = getGmailRow(db)!.connection_token!;
    expect(updateGmailTokens(db, config.tokenEncryptionKey, { access_token: "ACCESS-TWO-xyz" }, later(10), conn)).toBe(true);
    expect(getGmailTokens(db, config.tokenEncryptionKey)).toMatchObject({ access_token: "ACCESS-TWO-xyz", refresh_token: "REFRESH-ONE-xyz" });
    const status = JSON.stringify(getIntegrationStatus(db, config, T));
    expect(status).not.toMatch(/ACCESS-|REFRESH-/);
    expect(JSON.parse(status).gmail).toMatchObject({ state: "connected", email: "inbox@test.dev" });
    const raw = db.prepare("SELECT credentials_enc FROM integrations").get() as { credentials_enc: string };
    expect(raw.credentials_enc).not.toMatch(/ACCESS-|REFRESH-/);
    disconnectGmail(db, later(20));
    expect(getGmailTokens(db, config.tokenEncryptionKey)).toBeNull();
  });
});

describe("sessions", () => {
  it("stores only hashes, expires, and revokes", () => {
    const { db, config } = makeTestDb();
    const { token } = createSession(db, config.sessionSecret, T);
    const row = db.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string };
    expect(row.token_hash).not.toBe(token);
    expect(lookupSession(db, config.sessionSecret, token, later(60))).not.toBeNull();
    expect(lookupSession(db, config.sessionSecret, token, later(8 * 86400))).toBeNull();
    revokeSession(db, config.sessionSecret, token, later(61));
    expect(lookupSession(db, config.sessionSecret, token, later(62))).toBeNull();
  });
});

describe("oauth state", () => {
  it("binds to the session, expires, and is single-use", () => {
    const { db, config } = makeTestDb();
    const s1 = createSession(db, config.sessionSecret, T);
    const s2 = createSession(db, config.sessionSecret, T);
    const id1 = lookupSession(db, config.sessionSecret, s1.token, T)!.id;
    const id2 = lookupSession(db, config.sessionSecret, s2.token, T)!.id;

    const a = createOauthState(db, id1, T);
    expect(consumeOauthState(db, a, id2, later(5))).toBe("session_mismatch");
    expect(consumeOauthState(db, a, id1, later(6))).toBe("replayed"); // consumed by the failed attempt

    const b = createOauthState(db, id1, T);
    expect(consumeOauthState(db, b, id1, later(5))).toBe("ok");
    expect(consumeOauthState(db, b, id1, later(6))).toBe("replayed");

    const c = createOauthState(db, id1, T);
    expect(consumeOauthState(db, c, id1, later(601))).toBe("expired");
    expect(consumeOauthState(db, "made-up", id1, T)).toBe("invalid");
    expect(consumeOauthState(db, undefined, id1, T)).toBe("invalid");
  });
});

describe("settings validation", () => {
  it("rejects wildcard senders and unknown timezones; normalizes case", () => {
    const { db } = makeTestDb();
    expect(() => patchSettings(db, { allowedSenders: ["*@client.com"] }, T)).toThrow(DomainError);
    expect(() => patchSettings(db, { notifications: { quietHours: { timezone: "Mars/Base" } } }, T)).toThrow(DomainError);
    expect(patchSettings(db, { allowedSenders: [" Boss@Client.COM "] }, T).allowedSenders).toEqual(["boss@client.com"]);
  });
});

describe("artifact path safety", () => {
  it("rejects traversal, absolute paths, and symlink escapes", () => {
    const { db, config } = makeTestDb();
    const { taskId } = runToReady(db, config, "k", T);
    const rel = (db.prepare("SELECT rel_path FROM artifacts WHERE task_id=? LIMIT 1").get(taskId) as { rel_path: string }).rel_path;
    expect(resolveArtifactPath(config.artifactsDir, rel)).toBeTruthy();
    expect(resolveArtifactPath(config.artifactsDir, "../test.sqlite")).toBeNull();
    expect(resolveArtifactPath(config.artifactsDir, "/etc/passwd")).toBeNull();
    const outside = path.join(tmpdir(), `ah-secret-${Date.now()}.txt`);
    writeFileSync(outside, "secret");
    mkdirSync(path.join(config.artifactsDir, "evil"), { recursive: true });
    symlinkSync(outside, path.join(config.artifactsDir, "evil", "link.docx"));
    expect(resolveArtifactPath(config.artifactsDir, "evil/link.docx")).toBeNull();
  });
});
