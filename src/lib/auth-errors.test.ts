import { describe, expect, it } from "vitest";
import { authErrorRecord, isAuthInfraError } from "./auth-errors";

describe("isAuthInfraError", () => {
  it("is false for user-class codes", () => {
    for (const code of [
      "invalid_credentials",
      "user_already_exists",
      "email_exists",
      "weak_password",
      "email_not_confirmed",
      "over_request_rate_limit",
      "over_email_send_rate_limit",
    ]) {
      expect(isAuthInfraError({ name: "AuthApiError", status: 400, code })).toBe(false);
    }
  });

  it("is false for a missing session", () => {
    expect(isAuthInfraError({ name: "AuthSessionMissingError", status: 400 })).toBe(false);
  });

  it("is true for 5xx, retryable fetch errors, hooks and unmapped codes", () => {
    expect(isAuthInfraError({ name: "AuthApiError", status: 500, code: "unexpected_failure" })).toBe(true);
    expect(isAuthInfraError({ name: "AuthApiError", status: 503 })).toBe(true);
    expect(isAuthInfraError({ name: "AuthRetryableFetchError", status: 0 })).toBe(true);
    expect(isAuthInfraError({ name: "AuthRetryableFetchError" })).toBe(true);
    expect(isAuthInfraError({ name: "AuthApiError", status: 400, code: "hook_timeout" })).toBe(true);
    expect(isAuthInfraError({ name: "AuthApiError", status: 400, code: "something_new" })).toBe(true);
  });

  it("treats app codes and non-objects as infra, never throwing", () => {
    expect(isAuthInfraError({ code: "not_configured" })).toBe(true);
    expect(isAuthInfraError(new Error("x"))).toBe(true);
    expect(isAuthInfraError(null)).toBe(true);
    expect(isAuthInfraError("x")).toBe(true);
  });
});

describe("authErrorRecord", () => {
  it("keeps only code, name and status", () => {
    const record = authErrorRecord({
      code: "invalid_credentials",
      name: "AuthApiError",
      status: 400,
      message: "a@b.pl",
    });
    expect(record).toEqual({ code: "invalid_credentials", name: "AuthApiError", status: 400 });
    expect(JSON.stringify(record)).not.toContain("a@b.pl");
  });

  it("falls back for missing fields", () => {
    expect(authErrorRecord(undefined)).toEqual({ code: "none", name: "UnknownError", status: null });
  });
});
