import { describe, expect, it } from "vitest";
import { loginUrlFor, safeNext } from "../app/lib/next";

describe("post-login return path", () => {
  it("keeps same-origin relative paths, including a query", () => {
    expect(safeNext("/tasks/abc-123")).toBe("/tasks/abc-123");
    expect(safeNext("/tasks/abc?tab=files")).toBe("/tasks/abc?tab=files");
    expect(safeNext("/settings")).toBe("/settings");
  });
  it("falls back to the queue for anything that could leave the site or loop", () => {
    for (const bad of [null, undefined, "", "tasks/x", "//evil.example/x", "///evil", "/\\evil", "https://evil.example", "javascript:alert(1)", "/login", "/login?next=/x", "/a\nb", "/a\u0000b", "/" + "a".repeat(600)]) {
      expect(safeNext(bad as string | null | undefined)).toBe("/");
    }
  });
  it("builds the sign-in URL with an encoded return path, not for the queue or the login page itself", () => {
    expect(loginUrlFor("/tasks/abc", "")).toBe("/login?next=%2Ftasks%2Fabc");
    expect(loginUrlFor("/tasks/abc", "?x=1&y=2")).toBe("/login?next=%2Ftasks%2Fabc%3Fx%3D1%26y%3D2");
    expect(loginUrlFor("/", "")).toBe("/login");
    expect(loginUrlFor("/login", "?next=/x")).toBe("/login");
    expect(safeNext(decodeURIComponent("%2Ftasks%2Fabc%3Fx%3D1"))).toBe("/tasks/abc?x=1");
  });
});
