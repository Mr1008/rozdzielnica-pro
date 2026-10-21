import { afterEach, describe, expect, it, vi } from "vitest";
import { logServerError, serverErrorRecord } from "./server-log";

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
});
