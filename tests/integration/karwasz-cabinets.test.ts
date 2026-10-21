import { describe, expect, it } from "vitest";
import { parseCabinetGeometry } from "@/lib/cabinet-geometry";
import { KARWASZ_CABINETS, KARWASZ_MANUFACTURER, karwaszGeometry } from "@/lib/karwasz-cabinets";
import { createServiceClient, readStackEnv } from "./support";

/**
 * The production Karwasz cabinets arrive by a data migration generated from `src/lib/karwasz-cabinets.ts`.
 * This proves what the database actually holds after the migration is what the module says.
 */

describe("seeded Karwasz cabinets", () => {
  it("hold the module's 33 rows with valid geometry", async () => {
    const service = createServiceClient(readStackEnv());
    const { data, error } = await service
      .from("cabinets")
      .select("name, model, price_grosze, geometry")
      .eq("manufacturer", KARWASZ_MANUFACTURER)
      // Keyed on the module's models, so a Karwasz cabinet added locally through the UI doesn't break it.
      .in(
        "model",
        KARWASZ_CABINETS.map((cabinet) => cabinet.model),
      );

    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows).toHaveLength(KARWASZ_CABINETS.length);

    for (const row of rows) {
      expect(parseCabinetGeometry(row.geometry), `${row.model} must be valid geometry`).toMatchObject({ ok: true });

      const expected = KARWASZ_CABINETS.find((cabinet) => cabinet.model === row.model);
      if (!expected) throw new Error(`${row.model} is not in the module`);
      expect(row.name).toBe(expected.name);
      expect(row.price_grosze).toBe(expected.priceGrosze);
      expect(row.geometry).toEqual(karwaszGeometry(expected));
    }
  });
});
