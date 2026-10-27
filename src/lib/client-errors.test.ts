import { describe, expect, it } from "vitest";
import { buildClientErrorReport, parseClientErrorReport } from "./client-errors";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

describe("parseClientErrorReport", () => {
  it("accepts a valid report and drops unknown keys", () => {
    const result = parseClientErrorReport({ source: "window", message: "boom", path: "/x", projectId: UUID, evil: 1 });
    expect(result).toEqual({
      ok: true,
      report: { source: "window", message: "boom", stack: "", path: "/x", projectId: UUID },
    });
  });

  it("truncates overlong strings", () => {
    const result = parseClientErrorReport({
      source: "boundary",
      message: "m".repeat(500),
      stack: "s".repeat(5000),
      path: "p".repeat(500),
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.report.message).toHaveLength(201);
    expect(result.report.stack).toHaveLength(2049);
    expect(result.report.path).toHaveLength(201);
  });

  it("rejects non-object bodies, unknown sources and wrong types", () => {
    for (const body of [null, undefined, "x", 3, [], { message: "m" }, { source: "nope", message: "m" }]) {
      expect(parseClientErrorReport(body)).toEqual({ ok: false });
    }
    expect(parseClientErrorReport({ source: "window", message: 5 })).toEqual({ ok: false });
    expect(parseClientErrorReport({ source: "window", message: "m", stack: 5 })).toEqual({ ok: false });
    expect(parseClientErrorReport({ source: "window", message: "m", path: {} })).toEqual({ ok: false });
  });

  it("drops a projectId that is not a uuid", () => {
    const result = parseClientErrorReport({ source: "wiring", message: "m", projectId: "nope" });
    expect(result.ok && "projectId" in result.report).toBe(false);
  });
});

describe("buildClientErrorReport", () => {
  it("builds a report that round-trips through the parser", () => {
    const report = buildClientErrorReport("rejection", new TypeError("bad"), { path: "/p", projectId: UUID });
    expect(report.message).toBe("bad");
    expect(report.stack).toContain("TypeError");
    expect(parseClientErrorReport(report)).toEqual({ ok: true, report });
  });

  it("handles non-Error values", () => {
    expect(buildClientErrorReport("window", "plain").message).toBe("plain");
    expect(buildClientErrorReport("window", { a: 1 }).message).toBe("");
  });
});
