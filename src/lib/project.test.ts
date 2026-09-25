import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_NAME_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  MAX_SITE_ADDRESS_LENGTH,
  NEW_PROJECT_PATH,
  PROJECTS_API_PATH,
  PROJECTS_PATH,
  parseCabinetChoice,
  parseDeleteConfirmation,
  parseNewProjectForm,
  parseProjectDetailsForm,
  projectApiPath,
  projectCabinetApiPath,
  projectDeleteApiPath,
  projectPath,
  projectFormErrorPath,
  projectsErrorPath,
  projectSupplyApiPath,
} from "./project";

/**
 * The parsers must reject exactly what the `projects` text CHECKs reject — these cases pin every
 * limit on the TypeScript side; `tests/integration/rls-projects.test.ts` covers the database.
 */

const CABINET_ID = "0f8c3a52-4b1e-4f4a-9d51-6f1f0b7c2a10";
const VALID = { name: "Dom Kowalskich", client_name: "Jan Kowalski", site_address: "ul. Polna 1, Kraków" };

type Field = keyof typeof VALID | "cabinet_id";

function form(fields: Partial<Record<Field, string>>, omit: Field[] = []): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({ ...VALID, cabinet_id: CABINET_ID, ...fields })) {
    if (!omit.includes(name as Field)) data.set(name, value);
  }
  return data;
}

function details(fields: Partial<Record<Field, string>>) {
  const result = parseProjectDetailsForm(form(fields));
  return result.ok ? result.value : null;
}

const INVALID = { ok: false, code: "invalid_input" };

describe("project paths", () => {
  it("build the page and endpoint paths", () => {
    expect(PROJECTS_PATH).toBe("/dashboard/projects");
    expect(NEW_PROJECT_PATH).toBe("/dashboard/projects/new");
    expect(projectPath(CABINET_ID)).toBe(`/dashboard/projects/${CABINET_ID}`);
    expect(PROJECTS_API_PATH).toBe("/api/projects");
    expect(projectApiPath("x")).toBe("/api/projects/x");
    expect(projectCabinetApiPath("x")).toBe("/api/projects/x/cabinet");
    expect(projectSupplyApiPath("x")).toBe("/api/projects/x/supply");
    expect(projectDeleteApiPath("x")).toBe("/api/projects/x/delete");
  });

  it("build the error redirects, encoding the code", () => {
    expect(projectsErrorPath("not_found")).toBe("/dashboard/projects?error=not_found");
    expect(projectFormErrorPath(null, "invalid_input")).toBe("/dashboard/projects/new?error=invalid_input");
    expect(projectFormErrorPath(CABINET_ID, "a&b")).toBe(`/dashboard/projects/${CABINET_ID}?error=a%26b`);
  });
});

describe("text limits", () => {
  it("match the migration's CHECKs", () => {
    expect([MAX_PROJECT_NAME_LENGTH, MAX_CLIENT_NAME_LENGTH, MAX_SITE_ADDRESS_LENGTH]).toEqual([200, 200, 300]);
  });
});

describe("parseProjectDetailsForm", () => {
  it("turns a valid form into the column shape, trimmed", () => {
    expect(
      parseProjectDetailsForm(form({ name: "  Dom  ", client_name: " Jan ", site_address: "\tKraków\n" })),
    ).toEqual({ ok: true, value: { name: "Dom", client_name: "Jan", site_address: "Kraków" } });
  });

  it("requires a name", () => {
    for (const name of ["", " ", "\t\n "]) expect(details({ name }), JSON.stringify(name)).toBeNull();
    expect(parseProjectDetailsForm(form({}, ["name"]))).toEqual(INVALID);
  });

  it("limits the name to 200 characters", () => {
    expect(details({ name: "a".repeat(200) })?.name).toHaveLength(200);
    expect(details({ name: "a".repeat(201) })).toBeNull();
    expect(details({ name: ` ${"a".repeat(200)} ` })?.name).toHaveLength(200);
  });

  it("counts code points, like Postgres char_length", () => {
    // 200 emoji are 400 UTF-16 units but 200 characters to the database.
    expect(details({ name: "⚡".repeat(200) })).not.toBeNull();
    expect(details({ name: "🔌".repeat(200) })).not.toBeNull();
    expect(details({ name: "🔌".repeat(201) })).toBeNull();
  });

  it("turns a blank or missing client and address into null", () => {
    expect(details({ client_name: "", site_address: "   " })).toEqual({
      name: VALID.name,
      client_name: null,
      site_address: null,
    });
    const result = parseProjectDetailsForm(form({}, ["client_name", "site_address"]));
    expect(result).toEqual({ ok: true, value: { name: VALID.name, client_name: null, site_address: null } });
  });

  it("limits the client to 200 and the address to 300 characters", () => {
    expect(details({ client_name: "k".repeat(200) })?.client_name).toHaveLength(200);
    expect(details({ client_name: "k".repeat(201) })).toBeNull();
    expect(details({ site_address: "a".repeat(300) })?.site_address).toHaveLength(300);
    expect(details({ site_address: "a".repeat(301) })).toBeNull();
  });

  it("rejects a file where a text field is expected", () => {
    for (const field of ["name", "client_name", "site_address"]) {
      const data = form({});
      data.set(field, new Blob(["Dom"]));
      expect(parseProjectDetailsForm(data), field).toEqual(INVALID);
    }
  });
});

describe("parseCabinetChoice", () => {
  it("accepts a uuid", () => {
    expect(parseCabinetChoice(form({}))).toEqual({ ok: true, value: CABINET_ID });
    expect(parseCabinetChoice(form({ cabinet_id: ` ${CABINET_ID} ` }))).toEqual({ ok: true, value: CABINET_ID });
  });

  it("rejects a missing, blank or non-uuid cabinet", () => {
    expect(parseCabinetChoice(form({}, ["cabinet_id"]))).toEqual(INVALID);
    for (const cabinet_id of ["", " ", "1", "not-a-uuid", `${CABINET_ID}x`, "'; drop table projects; --"]) {
      expect(parseCabinetChoice(form({ cabinet_id })), cabinet_id).toEqual(INVALID);
    }
  });
});

describe("parseNewProjectForm", () => {
  it("combines the details and the cabinet choice", () => {
    expect(parseNewProjectForm(form({}))).toEqual({ ok: true, value: { ...VALID, cabinet_id: CABINET_ID } });
  });

  it("rejects when either half is invalid", () => {
    expect(parseNewProjectForm(form({ name: " " }))).toEqual(INVALID);
    expect(parseNewProjectForm(form({ cabinet_id: "nope" }))).toEqual(INVALID);
  });
});

describe("parseDeleteConfirmation", () => {
  it("requires the checkbox", () => {
    const ticked = new FormData();
    ticked.set("confirm_delete", "on");
    expect(parseDeleteConfirmation(ticked)).toEqual({ ok: true });
    expect(parseDeleteConfirmation(new FormData())).toEqual(INVALID);
  });
});
