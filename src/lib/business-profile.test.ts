import { describe, expect, it } from "vitest";
import {
  MAX_ADDRESS_LENGTH,
  MAX_COMPANY_NAME_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PHONE_LENGTH,
  businessFormDefaults,
  hasCompanyDetails,
  isValidNip,
  parseBusinessForm,
  type BusinessProfile,
} from "./business-profile";

/**
 * The parser must reject everything the `business_profiles` CHECKs reject — these cases pin every
 * bound on both sides. The NIP checksum is stricter than the CHECK, on purpose.
 */

const EMPTY = { company_name: "", nip: "", address: "", phone: "", email: "" };
const VALID_NIP = "5260250995";
const WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

function form(fields: Partial<typeof EMPTY>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({ ...EMPTY, ...fields })) data.set(name, value);
  return data;
}

function parsed(fields: Partial<typeof EMPTY>) {
  const result = parseBusinessForm(form(fields));
  return result.ok ? result.value : null;
}

describe("parseBusinessForm", () => {
  it("turns an all-empty form into all nulls", () => {
    expect(parsed({})).toEqual({ company_name: null, nip: null, address: null, phone: null, email: null });
  });

  it("treats a missing field like an empty one", () => {
    expect(parseBusinessForm(new FormData())).toEqual({
      ok: true,
      value: { company_name: null, nip: null, address: null, phone: null, email: null },
    });
  });

  it("trims every value and turns whitespace-only into null", () => {
    expect(
      parsed({ company_name: "  Elektro  ", nip: "   ", address: " \n ", phone: " +48 123 ", email: "  a@b.pl " }),
    ).toEqual({ company_name: "Elektro", nip: null, address: null, phone: "+48 123", email: "a@b.pl" });
  });

  it("accepts every field at its maximum and refuses one past it", () => {
    const cases: [keyof typeof EMPTY, string, number][] = [
      ["company_name", "a", MAX_COMPANY_NAME_LENGTH],
      ["address", "a", MAX_ADDRESS_LENGTH],
      ["phone", "1", MAX_PHONE_LENGTH],
    ];
    for (const [field, char, max] of cases) {
      expect(parsed({ [field]: char.repeat(max) }), field).not.toBeNull();
      expect(parsed({ [field]: char.repeat(max + 1) }), field).toBeNull();
    }
    const domain = "@b.pl";
    expect(parsed({ email: "a".repeat(MAX_EMAIL_LENGTH - domain.length) + domain })).not.toBeNull();
    expect(parsed({ email: "a".repeat(MAX_EMAIL_LENGTH - domain.length + 1) + domain })).toBeNull();
  });

  it("counts code points, not UTF-16 units", () => {
    expect(parsed({ company_name: "😀".repeat(MAX_COMPANY_NAME_LENGTH) })).not.toBeNull();
    expect(parsed({ company_name: "😀".repeat(MAX_COMPANY_NAME_LENGTH + 1) })).toBeNull();
  });

  it("allows newlines inside an address", () => {
    expect(parsed({ address: "ul. Długa 1\n00-001 Warszawa" })?.address).toBe("ul. Długa 1\n00-001 Warszawa");
  });

  it("accepts a valid NIP with and without separators and stores ten digits", () => {
    expect(parsed({ nip: VALID_NIP })?.nip).toBe(VALID_NIP);
    expect(parsed({ nip: "526-025-09-95" })?.nip).toBe(VALID_NIP);
    expect(parsed({ nip: "526 025 09 95" })?.nip).toBe(VALID_NIP);
  });

  it("refuses a bad checksum, 9 or 11 digits, and letters in the NIP", () => {
    expect(parsed({ nip: "5260250996" })).toBeNull();
    expect(parsed({ nip: "526025099" })).toBeNull();
    expect(parsed({ nip: "52602509950" })).toBeNull();
    expect(parsed({ nip: "PL5260250995" })).toBeNull();
  });

  it("refuses a phone with letters and accepts the allowed punctuation", () => {
    expect(parsed({ phone: "12 345 abc" })).toBeNull();
    expect(parsed({ phone: "+48 (12) 345-67-89" })?.phone).toBe("+48 (12) 345-67-89");
  });

  it("refuses an email without an @, with two, or with whitespace", () => {
    expect(parsed({ email: "ab.pl" })).toBeNull();
    expect(parsed({ email: "a@@b.pl" })).toBeNull();
    expect(parsed({ email: "a b@c.pl" })).toBeNull();
    expect(parsed({ email: "a@" })).toBeNull();
  });

  it("round-trips a stored row through businessFormDefaults", () => {
    const row: BusinessProfile = {
      company_name: "Elektro Kowalski",
      nip: VALID_NIP,
      address: "ul. Długa 1\n00-001 Warszawa",
      phone: "+48 123 456 789",
      email: "biuro@example.pl",
    };
    expect(parsed(businessFormDefaults(row))).toEqual(row);
  });
});

describe("isValidNip", () => {
  it("checks the checksum", () => {
    expect(isValidNip(VALID_NIP)).toBe(true);
    expect(isValidNip("5260250996")).toBe(false);
    expect(isValidNip("123")).toBe(false);
  });

  it("never accepts a remainder of 10", () => {
    let checked = 0;
    for (let n = 0; n < 100_000; n++) {
      const head = String(n).padStart(5, "0") + "1234";
      const sum = WEIGHTS.reduce((total, weight, index) => total + weight * Number(head[index]), 0);
      if (sum % 11 !== 10) continue;
      checked += 1;
      for (let last = 0; last <= 9; last++) expect(isValidNip(`${head}${String(last)}`)).toBe(false);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("businessFormDefaults", () => {
  it("returns empty strings for no row and for null columns", () => {
    expect(businessFormDefaults(null)).toEqual(EMPTY);
    expect(businessFormDefaults({ company_name: null, nip: null, address: null, phone: null, email: null })).toEqual(
      EMPTY,
    );
  });
});

describe("hasCompanyDetails", () => {
  it("is true only when a company name is set", () => {
    expect(hasCompanyDetails(null)).toBe(false);
    expect(hasCompanyDetails({ company_name: null })).toBe(false);
    expect(hasCompanyDetails({ company_name: "Elektro" })).toBe(true);
  });
});
