import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEOMETRY,
  cabinetDraftSchema,
  draftFromGeometry,
  draftFromRow,
  geometryFromDraft,
  isDrawable,
  newBarDraft,
  newRailDraft,
  numberFromField,
} from "./cabinet-draft";
import { parseCabinetForm } from "./cabinet-form";
import { parseCabinetGeometry, type CabinetGeometry } from "./cabinet-geometry";

const WITH_BARS: CabinetGeometry = {
  ...DEFAULT_GEOMETRY,
  bars: [
    {
      kind: "N",
      orientation: "horizontal",
      xMm: 10,
      yMm: 250,
      lengthMm: 200,
      heightMm: 15,
      zMm: 30,
      terminalGroups: [{ count: 12, minMm2: 1.5, maxMm2: 16 }],
    },
  ],
};

describe("numberFromField", () => {
  it("reads plain decimals with either separator", () => {
    expect(numberFromField("12")).toBe(12);
    expect(numberFromField(" 1,5 ")).toBe(1.5);
    expect(numberFromField("2.5")).toBe(2.5);
    expect(numberFromField("-3")).toBe(-3);
  });

  it("is NaN for anything else, so the geometry parser flags the field", () => {
    for (const raw of ["", " ", "1e3", "12 mm", "0x10", ","]) expect(numberFromField(raw), raw).toBeNaN();
  });
});

describe("draft round trip", () => {
  it("geometry → draft → geometry is lossless, decimals included", () => {
    expect(geometryFromDraft(draftFromGeometry(WITH_BARS))).toEqual(WITH_BARS);
    expect(draftFromGeometry(WITH_BARS).bars[0].terminalGroups[0].minMm2).toBe("1,5");
  });

  it("starts a new cabinet from a valid default geometry", () => {
    const draft = draftFromRow();
    expect(parseCabinetGeometry(geometryFromDraft(draft.geometry)).ok).toBe(true);
    expect(draft.price).toBe("");
  });

  it("pre-fills an existing row in a shape the form parser accepts", () => {
    const draft = draftFromRow({
      id: "00000000-0000-0000-0000-000000000001",
      name: "Szafka",
      manufacturer: "Producent",
      model: "M-1",
      price_grosze: 123456,
      geometry: WITH_BARS,
    });
    const form = new FormData();
    form.set("name", draft.name);
    form.set("manufacturer", draft.manufacturer);
    form.set("model", draft.model);
    form.set("price", draft.price);
    form.set("geometry", JSON.stringify(geometryFromDraft(draft.geometry)));
    expect(parseCabinetForm(form)).toMatchObject({ ok: true, value: { price_grosze: 123456, geometry: WITH_BARS } });
  });

  it("turns a malformed stored geometry into empty fields instead of throwing", () => {
    const draft = draftFromGeometry({ interior: { widthMm: "wide" }, rails: [{ xMm: 1 }, 7], bars: "none" });
    expect(draft.interior).toEqual({ widthMm: "", heightMm: "", depthMm: "" });
    expect(draft.rails).toEqual([{ xMm: "1", yMm: "", lengthMm: "" }]);
    expect(draft.entries).toEqual([]);
    expect(draft.bars).toEqual([]);
    expect(draftFromGeometry(null).rails).toEqual([]);
  });

  it("a draft survives JSON storage and the restore schema", () => {
    const draft = draftFromRow();
    draft.geometry.bars.push(newBarDraft());
    expect(cabinetDraftSchema.parse(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    expect(cabinetDraftSchema.safeParse({ name: "x" }).success).toBe(false);
  });
});

describe("isDrawable", () => {
  it("draws a geometry that breaks placement rules", () => {
    const overlapping = {
      ...DEFAULT_GEOMETRY,
      rails: [...DEFAULT_GEOMETRY.rails, { xMm: 0, yMm: 110, lengthMm: 900 }],
    };
    expect(parseCabinetGeometry(overlapping).ok).toBe(false);
    expect(isDrawable(overlapping)).toBe(true);
  });

  it("refuses a candidate with an empty field or a non-positive size", () => {
    const draft = draftFromGeometry(DEFAULT_GEOMETRY);
    expect(isDrawable(geometryFromDraft({ ...draft, interior: { ...draft.interior, widthMm: "" } }))).toBe(false);
    expect(isDrawable(geometryFromDraft({ ...draft, rails: [{ xMm: "0", yMm: "", lengthMm: "10" }] }))).toBe(false);
    expect(isDrawable(geometryFromDraft({ ...draft, rails: [{ xMm: "0", yMm: "0", lengthMm: "0" }] }))).toBe(false);
  });
});

describe("newRailDraft", () => {
  it("places the new rail one pitch below the lowest, full width", () => {
    expect(newRailDraft(draftFromGeometry(DEFAULT_GEOMETRY))).toEqual({ xMm: "0", yMm: "225", lengthMm: "400" });
    expect(newRailDraft({ ...draftFromGeometry(DEFAULT_GEOMETRY), rails: [] }).yMm).toBe("0");
  });
});
