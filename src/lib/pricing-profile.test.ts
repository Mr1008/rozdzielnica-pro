import { describe, expect, it } from "vitest";
import { MAX_PRICE_GROSZE } from "./price-input";
import {
  MAX_MOUNT_MINUTES,
  MAX_OVERHEAD_MINUTES,
  MIN_MOUNT_MINUTES,
  MIN_OVERHEAD_MINUTES,
  parsePricingForm,
  pricingFormDefaults,
} from "./pricing-profile";

/**
 * The parser must reject exactly what the `pricing_profiles` CHECKs reject — these cases pin every
 * bound on both sides, so a drift between the two guards fails here or in the RLS suite.
 */

const VALID = { hourly_rate: "120,50", mount_minutes_per_device: "15", project_overhead_minutes: "0" };

function form(fields: Partial<Record<keyof typeof VALID, string>>, omit: (keyof typeof VALID)[] = []): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({ ...VALID, ...fields })) {
    if (!omit.includes(name as keyof typeof VALID)) data.set(name, value);
  }
  return data;
}

function parsedValue(fields: Partial<Record<keyof typeof VALID, string>>) {
  const result = parsePricingForm(form(fields));
  return result.ok ? result.value : null;
}

describe("pricing bounds", () => {
  it("match the migration's CHECKs", () => {
    expect([MIN_MOUNT_MINUTES, MAX_MOUNT_MINUTES]).toEqual([1, 600]);
    expect([MIN_OVERHEAD_MINUTES, MAX_OVERHEAD_MINUTES]).toEqual([0, 6000]);
  });
});

describe("parsePricingForm", () => {
  it("turns a valid form into the row shape", () => {
    expect(parsePricingForm(form({}))).toEqual({
      ok: true,
      value: { hourly_rate_grosze: 12050, mount_minutes_per_device: 15, project_overhead_minutes: 0 },
    });
  });

  it("accepts comma and dot rates, and whole złote", () => {
    expect(parsedValue({ hourly_rate: "120,5" })?.hourly_rate_grosze).toBe(12050);
    expect(parsedValue({ hourly_rate: "120.50" })?.hourly_rate_grosze).toBe(12050);
    expect(parsedValue({ hourly_rate: "120" })?.hourly_rate_grosze).toBe(12000);
    expect(parsedValue({ hourly_rate: " 0,01 " })?.hourly_rate_grosze).toBe(1);
  });

  it("rejects a zero, negative, over-precise or oversized rate", () => {
    for (const hourly_rate of ["0", "0,00", "-5", "120,505", "1 200", "120 zł", "", String(MAX_PRICE_GROSZE)]) {
      expect(parsePricingForm(form({ hourly_rate })), hourly_rate).toEqual({ ok: false, code: "invalid_input" });
    }
  });

  it("enforces the mount-time bounds 1…600", () => {
    expect(parsedValue({ mount_minutes_per_device: "0" })).toBeNull();
    expect(parsedValue({ mount_minutes_per_device: "1" })?.mount_minutes_per_device).toBe(1);
    expect(parsedValue({ mount_minutes_per_device: "600" })?.mount_minutes_per_device).toBe(600);
    expect(parsedValue({ mount_minutes_per_device: "601" })).toBeNull();
  });

  it("enforces the overhead bounds 0…6000", () => {
    expect(parsedValue({ project_overhead_minutes: "0" })?.project_overhead_minutes).toBe(0);
    expect(parsedValue({ project_overhead_minutes: "6000" })?.project_overhead_minutes).toBe(6000);
    expect(parsedValue({ project_overhead_minutes: "6001" })).toBeNull();
  });

  it("accepts only whole digits for minutes, after trimming", () => {
    expect(parsedValue({ mount_minutes_per_device: " 15 " })?.mount_minutes_per_device).toBe(15);
    // A `type="number"` input submits a whole number typed as `15.0` unchanged.
    expect(parsedValue({ mount_minutes_per_device: "15.0" })?.mount_minutes_per_device).toBe(15);
    expect(parsedValue({ project_overhead_minutes: "0.00" })?.project_overhead_minutes).toBe(0);
    for (const minutes of ["7,5", "7.5", "15.", "15.01", "-1", "-0", "+5", "1e2", "0x10", "", " "]) {
      expect(parsedValue({ mount_minutes_per_device: minutes }), `mount ${minutes}`).toBeNull();
      expect(parsedValue({ project_overhead_minutes: minutes }), `overhead ${minutes}`).toBeNull();
    }
  });

  it("rejects a form missing any field", () => {
    for (const field of Object.keys(VALID) as (keyof typeof VALID)[]) {
      expect(parsePricingForm(form({}, [field])), field).toEqual({ ok: false, code: "invalid_input" });
    }
  });

  it("rejects a file where a text field is expected", () => {
    const data = form({});
    data.set("mount_minutes_per_device", new Blob(["15"]));
    expect(parsePricingForm(data)).toEqual({ ok: false, code: "invalid_input" });
  });
});

describe("pricingFormDefaults", () => {
  it("returns empty strings when nothing is configured", () => {
    expect(pricingFormDefaults(null)).toEqual({
      hourly_rate: "",
      mount_minutes_per_device: "",
      project_overhead_minutes: "",
    });
  });

  it("pre-fills a stored row in a shape the parser accepts unchanged", () => {
    const row = { hourly_rate_grosze: 12050, mount_minutes_per_device: 15, project_overhead_minutes: 0 };
    const defaults = pricingFormDefaults(row);

    expect(defaults).toEqual({ hourly_rate: "120,50", mount_minutes_per_device: "15", project_overhead_minutes: "0" });
    expect(parsePricingForm(form(defaults))).toEqual({ ok: true, value: row });
  });
});
