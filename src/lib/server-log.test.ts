import { afterEach, describe, expect, it, vi } from "vitest";
import { logServerError, logServerInfo, logServerWarn, serverErrorRecord } from "./server-log";

describe("serverErrorRecord", () => {
  it("keeps the code, hint and message of a PostgREST error", () => {
    const record = serverErrorRecord("project.insert", {
      code: "23505",
      message: "duplicate key",
      hint: "try again",
      name: "PostgrestError",
    });
    expect(record).toMatchObject({
      event: "project.insert",
      code: "23505",
      name: "PostgrestError",
      hint: "try again",
      message: "duplicate key",
    });
  });

  it("reports an empty code as a transport failure", () => {
    expect(serverErrorRecord("e", { code: "", message: "fetch failed" }).code).toBe("transport");
  });

  it("reports a missing code as none", () => {
    expect(serverErrorRecord("e", { message: "bad gateway" }).code).toBe("none");
    expect(serverErrorRecord("e", { code: null }).code).toBe("none");
  });

  it("never carries details, which echo row values", () => {
    const record = serverErrorRecord("e", { code: "23505", details: "Key (email)=(a@b.pl) already exists." });
    expect("details" in record).toBe(false);
    expect(JSON.stringify(record)).not.toContain("a@b.pl");
  });

  it("truncates a long message with an ellipsis", () => {
    const record = serverErrorRecord("e", { message: "x".repeat(500) });
    expect(record.message).toHaveLength(201);
    expect(record.message.endsWith("…")).toBe(true);
  });

  it("truncates a long hint", () => {
    expect(serverErrorRecord("e", { code: "1", hint: "h".repeat(500) }).hint).toHaveLength(201);
  });

  it("masks quoted input in a class 22 message", () => {
    const record = serverErrorRecord("e", { code: "22P02", message: 'invalid input syntax for type uuid: "jan@x.pl"' });
    expect(record.message).toBe('invalid input syntax for type uuid: "…"');
  });

  it("leaves quoted names in other messages", () => {
    const message = 'new row violates check constraint "projects_name_valid"';
    expect(serverErrorRecord("e", { code: "23514", message }).message).toBe(message);
  });

  it("keeps name, message and stack of a plain Error", () => {
    const error = new TypeError("boom");
    const record = serverErrorRecord("e", error);
    expect(record.name).toBe("TypeError");
    expect(record.message).toBe("boom");
    expect(record.stack).toBe(error.stack);
  });

  it("omits the stack for a non-Error object", () => {
    expect("stack" in serverErrorRecord("e", { code: "42501", stack: "fake" })).toBe(false);
  });

  it("still produces a record for non-object input", () => {
    expect(serverErrorRecord("e", "plain string")).toMatchObject({ code: "none", message: "plain string" });
    expect(serverErrorRecord("e", undefined)).toMatchObject({ event: "e", code: "none", message: "" });
    expect(serverErrorRecord("e", null).code).toBe("none");
  });

  it("copies the context ids and drops undefined values", () => {
    const record = serverErrorRecord("e", { code: "1" }, { userId: "u1", projectId: "p1", extra: undefined });
    expect(record.userId).toBe("u1");
    expect(record.projectId).toBe("p1");
    expect("extra" in record).toBe(false);
  });

  it("does not let context overwrite the core fields", () => {
    expect(serverErrorRecord("e", { code: "1" }, { code: "spoofed" }).code).toBe("1");
  });
});

describe("logServerError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls console.error exactly once with one plain object", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logServerError("project.insert", { code: "42501", message: "denied" }, { userId: "u1" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toHaveLength(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ event: "project.insert", code: "42501", userId: "u1" });
  });

  it("never throws, even when the error cannot be read", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hostile = {
      get code(): string {
        throw new Error("getter");
      },
    };
    expect(() => {
      logServerError("print view failed", hostile);
    }).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ event: "print view failed", code: "none" });
  });
});

describe("logServerWarn / logServerInfo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one flat record at warn level", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logServerWarn("project.invalid", { userId: "u1", count: 2, none: null, skipped: undefined });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toEqual({
      event: "project.invalid",
      level: "warn",
      userId: "u1",
      count: 2,
      none: null,
    });
  });

  it("writes one flat record at info level", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logServerInfo("match.done");
    expect(spy.mock.calls[0]?.[0]).toEqual({ event: "match.done", level: "info" });
  });

  it("does not let fields overwrite event or level, and never throws", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("sink");
    });
    expect(() => {
      logServerWarn("e", { level: "spoofed" });
    }).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
