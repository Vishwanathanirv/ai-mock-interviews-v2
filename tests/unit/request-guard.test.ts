import { describe, expect, it } from "vitest";
import { isJson, isSameOrigin, isUuid } from "@/lib/request-guard";

const req = (method: string, headers: Record<string, string>) => new Request("http://app.test/api/x", { method, headers });

describe("isSameOrigin", () => {
  it("allows safe methods and requests without an Origin header", () => {
    expect(isSameOrigin(req("GET", { origin: "https://evil.example" }))).toBe(true);
    expect(isSameOrigin(req("POST", {}))).toBe(true);
  });
  it("allows a POST from the same host", () => {
    expect(isSameOrigin(req("POST", { origin: "http://app.test", host: "app.test" }))).toBe(true);
    expect(isSameOrigin(req("POST", { origin: "https://rehearse.example", host: "internal:3000", "x-forwarded-host": "rehearse.example" }))).toBe(true);
  });
  it("blocks cross-site, opaque and malformed origins", () => {
    expect(isSameOrigin(req("POST", { origin: "https://evil.example", host: "app.test" }))).toBe(false);
    expect(isSameOrigin(req("DELETE", { origin: "http://app.test.evil.example", host: "app.test" }))).toBe(false);
    expect(isSameOrigin(req("POST", { origin: "null", host: "app.test" }))).toBe(false);
    expect(isSameOrigin(req("POST", { origin: "not a url", host: "app.test" }))).toBe(false);
  });
});

describe("isJson", () => {
  it("accepts JSON content types and refuses form or text posts", () => {
    expect(isJson(req("POST", { "content-type": "application/json" }))).toBe(true);
    expect(isJson(req("POST", { "content-type": "application/json; charset=utf-8" }))).toBe(true);
    expect(isJson(req("POST", { "content-type": "text/plain" }))).toBe(false);
    expect(isJson(req("POST", { "content-type": "application/x-www-form-urlencoded" }))).toBe(false);
    expect(isJson(req("POST", {}))).toBe(false);
  });
});

describe("isUuid", () => {
  it("accepts canonical UUIDs only", () => {
    expect(isUuid("946db1af-556e-4e3c-a6e1-393fc415e9ee")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("946db1af-556e-4e3c-a6e1-393fc415e9ee' or 1=1")).toBe(false);
  });
});
