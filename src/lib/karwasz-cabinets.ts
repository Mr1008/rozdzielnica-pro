import { RAIL_HEIGHT_MM, type CabinetGeometry } from "@/lib/cabinet-geometry";
import { DIN_MODULE_MM } from "@/lib/din-module";

/**
 * The Karwasz cabinets shipped to the production catalog by a data migration, and the rules that turn
 * each catalog row into a `CabinetGeometry`.
 *
 * Sources: the Karwasz 2022 catalog (outer dimensions, rails × modules, N/PE bars),
 * https://karwasz.com.pl/upfiles/katalogi/KATALOG%20-%202022-wersja%20skompresowana.pdf, and the price
 * list https://karwasz.com.pl/upfiles/Karwasz%20cennik%201.09.2026.xlsx, sheet "Cennik wyrobów
 * 28.08.2025". Prices are net list prices in PLN, stored as integer grosze; the "Z" (patent-lock)
 * price is used only where the price list has no plain variant. RP uses the "bez kołnierza" body size.
 *
 * Neither the catalog nor the website gives internal coordinates, so positions are synthesised by
 * fixed rules (tune the constants below only inside them):
 * - interior = the catalog W × H × D as-is;
 * - rails: `ceil(modules × 17.5)` long, centred horizontally, 125 mm apart top-to-top, the block
 *   centred vertically in the interior minus the bar strip;
 * - entries: two, top and bottom, each with a 10 % margin per end;
 * - bars (only where the catalog lists them): one N and one PE, horizontal in a strip below the bottom
 *   rail, at least 10 mm from rails and walls. Side by side if they fit across, else stacked in the
 *   strip, else overlapping at z 20 and 35. Nothing fits: `karwaszGeometry` throws.
 *
 * The migration generated from this module is immutable once deployed: never regenerate it. A data
 * fix (a price, a new model) goes into a new migration.
 */

export const KARWASZ_MANUFACTURER = "Karwasz";

export interface KarwaszCabinet {
  model: string;
  /** Catalog data in Polish, not a UI string. */
  name: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  rails: { count: number; modules: number };
  /** Terminals on each of the N and PE bar: `small` 1.5–16 mm², `mains` 6–32 mm². Null: no built-in bars. */
  bars: { mains: number; small: number } | null;
  priceGrosze: number;
}

type CatalogBars = NonNullable<KarwaszCabinet["bars"]>;

const RAIL_PITCH_MM = 125;
const ENTRY_MARGIN = 0.1;
const BAR_HEIGHT_MM = 12;
const BAR_CLEARANCE_MM = 10;
const BAR_MM_PER_TERMINAL = 10;
const BAR_END_MM = 20;
const BAR_Z_FRONT_MM = 20;
const BAR_Z_BACK_MM = 35;
const SMALL_TERMINAL_MM2 = { minMm2: 1.5, maxMm2: 16 };
const MAINS_TERMINAL_MM2 = { minMm2: 6, maxMm2: 32 };

const FOUR_BY_16: CatalogBars = { mains: 0, small: 4 };
const SEVEN_BY_16: CatalogBars = { mains: 0, small: 7 };
const MAIN_16: CatalogBars = { mains: 1, small: 16 };
const TWO_MAINS_16: CatalogBars = { mains: 2, small: 16 };

function cabinet(
  model: string,
  name: string,
  [widthMm, heightMm, depthMm]: readonly [number, number, number],
  [count, modules]: readonly [number, number],
  bars: KarwaszCabinet["bars"],
  priceGrosze: number,
): KarwaszCabinet {
  return { model, name, widthMm, heightMm, depthMm, rails: { count, modules }, bars, priceGrosze };
}

const uni = (width: number, height: number, railCount: number, modules: number, priceGrosze: number) =>
  cabinet(
    `UNI SYSTEM ${String(width)}-${String(height)}-250 M`,
    `Rozdzielnica natynkowa UNI SYSTEM ${String(width)}-${String(height)}-250 M, ${String(railCount)}×${String(modules)}`,
    [width, height, 250],
    [railCount, modules],
    null,
    priceGrosze,
  );

export const KARWASZ_CABINETS: readonly KarwaszCabinet[] = [
  cabinet("RN-6-P", "Rozdzielnica natynkowa RN-6-P, 1×6", [150, 215, 115], [1, 6], FOUR_BY_16, 9978),
  cabinet("RN-12-P", "Rozdzielnica natynkowa RN-12-P, 1×12", [255, 215, 115], [1, 12], SEVEN_BY_16, 14696),
  cabinet("RN-20", "Rozdzielnica natynkowa RN-20, 1×20", [410, 230, 185], [1, 20], MAIN_16, 21928),
  cabinet("RN-24", "Rozdzielnica natynkowa RN-24, 2×12", [255, 350, 115], [2, 12], MAIN_16, 20752),
  cabinet("RN-36", "Rozdzielnica natynkowa RN-36, 3×12", [255, 480, 115], [3, 12], MAIN_16, 23862),
  cabinet("RN-36 BIS", "Rozdzielnica natynkowa RN-36 BIS, 3×12", [255, 560, 185], [3, 12], MAIN_16, 27216),
  cabinet("RN-48", "Rozdzielnica natynkowa RN-48, 3×16", [345, 560, 115], [3, 16], MAIN_16, 33025),
  cabinet("RN-48 BIS", "Rozdzielnica natynkowa RN-48 BIS, 3×16", [345, 560, 185], [3, 16], MAIN_16, 38765),
  cabinet("RN-60", "Rozdzielnica natynkowa RN-60, 3×20", [410, 560, 115], [3, 20], MAIN_16, 36433),
  cabinet("RN-60 BIS", "Rozdzielnica natynkowa RN-60 BIS, 3×20", [410, 560, 185], [3, 20], MAIN_16, 37565),
  cabinet("RP-6-P", "Rozdzielnica podtynkowa RP-6-P, 1×6", [150, 215, 115], [1, 6], FOUR_BY_16, 10502),
  cabinet("RP-12-P", "Rozdzielnica podtynkowa RP-12-P, 1×12", [255, 215, 115], [1, 12], SEVEN_BY_16, 16395),
  cabinet("RP-20", "Rozdzielnica podtynkowa RP-20, 1×20", [410, 230, 115], [1, 20], MAIN_16, 22906),
  cabinet("RP-24", "Rozdzielnica podtynkowa RP-24, 2×12", [255, 350, 115], [2, 12], MAIN_16, 20767),
  cabinet("RP-36", "Rozdzielnica podtynkowa RP-36, 3×12", [255, 480, 115], [3, 12], MAIN_16, 25017),
  cabinet("RP-48", "Rozdzielnica podtynkowa RP-48, 3×16", [340, 560, 115], [3, 16], MAIN_16, 34590),
  cabinet("RP-60", "Rozdzielnica podtynkowa RP-60, 3×20", [410, 560, 115], [3, 20], MAIN_16, 38852),
  cabinet("RP-80", "Rozdzielnica podtynkowa RP-80, 4×20", [410, 720, 115], [4, 20], TWO_MAINS_16, 55259),
  cabinet("RP-100", "Rozdzielnica podtynkowa RP-100, 5×20", [410, 880, 115], [5, 20], TWO_MAINS_16, 68124),
  cabinet("RP-120", "Rozdzielnica podtynkowa RP-120, 6×20", [410, 1040, 115], [6, 20], TWO_MAINS_16, 81833),
  cabinet("RNH-6-P", "Rozdzielnica hermetyczna RNH-6-P IP54, 1×6", [150, 220, 140], [1, 6], FOUR_BY_16, 15235),
  cabinet("RNH-12-P", "Rozdzielnica hermetyczna RNH-12-P IP54, 1×12", [255, 220, 140], [1, 12], SEVEN_BY_16, 17277),
  cabinet("RNH-24", "Rozdzielnica hermetyczna RNH-24 IP54, 2×12", [255, 350, 140], [2, 12], MAIN_16, 27820),
  cabinet("RNH-36", "Rozdzielnica hermetyczna RNH-36 IP54, 3×12", [255, 480, 140], [3, 12], MAIN_16, 37776),
  cabinet("RNH-48", "Rozdzielnica hermetyczna RNH-48 IP54, 3×16", [345, 560, 140], [3, 16], MAIN_16, 48821),
  uni(550, 900, 5, 25, 149462),
  uni(750, 900, 5, 36, 185308),
  uni(550, 1050, 6, 25, 171249),
  uni(750, 1050, 6, 36, 210142),
  uni(550, 1200, 7, 25, 189994),
  uni(750, 1200, 7, 36, 233569),
  uni(550, 1450, 9, 25, 224197),
  uni(750, 1450, 9, 36, 274096),
];

type Bar = CabinetGeometry["bars"][number];

function barTerminalGroups({ mains, small }: CatalogBars): Bar["terminalGroups"] {
  return [{ count: small, ...SMALL_TERMINAL_MM2 }, ...(mains > 0 ? [{ count: mains, ...MAINS_TERMINAL_MM2 }] : [])];
}

/** A bar's length: 10 mm per terminal (a main terminal counts double) plus the ends. */
function barLengthMm({ mains, small }: CatalogBars): number {
  return BAR_MM_PER_TERMINAL * (small + 2 * mains) + BAR_END_MM;
}

interface BarSlot {
  xMm: number;
  /** Relative to the top of the strip below the rails. */
  yMm: number;
  zMm: number;
}

interface BarLayout {
  /** Height of the strip below the rails, including the clearance above the bars and the bottom wall. */
  stripMm: number;
  /** Slots for the N bar, then the PE bar. */
  slots: readonly [BarSlot, BarSlot];
}

/** The placements to try, in order of preference: side by side, stacked, then overlapping in depth. */
function barLayouts(widthMm: number, lengthMm: number): BarLayout[] {
  const edge = BAR_CLEARANCE_MM;
  const oneRowMm = edge + BAR_HEIGHT_MM + edge;
  const layouts: BarLayout[] = [];
  if (edge + lengthMm + edge + lengthMm + edge <= widthMm) {
    layouts.push({
      stripMm: oneRowMm,
      slots: [
        { xMm: edge, yMm: edge, zMm: BAR_Z_FRONT_MM },
        { xMm: widthMm - edge - lengthMm, yMm: edge, zMm: BAR_Z_FRONT_MM },
      ],
    });
  }
  if (edge + lengthMm + edge <= widthMm) {
    layouts.push(
      {
        stripMm: oneRowMm + BAR_HEIGHT_MM + edge,
        slots: [
          { xMm: edge, yMm: edge, zMm: BAR_Z_FRONT_MM },
          { xMm: edge, yMm: edge + BAR_HEIGHT_MM + edge, zMm: BAR_Z_FRONT_MM },
        ],
      },
      {
        stripMm: oneRowMm,
        slots: [
          { xMm: edge, yMm: edge, zMm: BAR_Z_FRONT_MM },
          { xMm: edge, yMm: edge, zMm: BAR_Z_BACK_MM },
        ],
      },
    );
  }
  return layouts;
}

/**
 * Builds a cabinet's geometry by the rules in the module header. Throws, naming the model, when the
 * rails and bars cannot be laid out in the interior.
 */
export function karwaszGeometry(cabinet: KarwaszCabinet): CabinetGeometry {
  const { widthMm, heightMm, depthMm, rails, bars } = cabinet;
  const railLengthMm = Math.ceil(rails.modules * DIN_MODULE_MM);
  const railBlockMm = (rails.count - 1) * RAIL_PITCH_MM + RAIL_HEIGHT_MM;
  if (railLengthMm > widthMm) throw new Error(`${cabinet.model}: rails do not fit across the interior`);

  const barLengthMmValue = bars ? barLengthMm(bars) : 0;
  const layout = bars
    ? barLayouts(widthMm, barLengthMmValue).find(
        (candidate) =>
          railBlockMm + candidate.stripMm <= heightMm && candidate.slots.every((slot) => slot.zMm <= depthMm),
      )
    : undefined;
  if (bars && !layout) throw new Error(`${cabinet.model}: no placement fits the rails and bars`);
  if (railBlockMm > heightMm) throw new Error(`${cabinet.model}: rails do not fit down the interior`);

  const stripMm = layout?.stripMm ?? 0;
  const railTop = Math.floor((heightMm - stripMm - railBlockMm) / 2);
  const entryOffset = Math.round(widthMm * ENTRY_MARGIN);

  const geometryBars: Bar[] =
    bars && layout
      ? (["N", "PE"] as const).map((kind, index) => ({
          kind,
          orientation: "horizontal",
          xMm: layout.slots[index].xMm,
          yMm: heightMm - stripMm + layout.slots[index].yMm,
          lengthMm: barLengthMmValue,
          heightMm: BAR_HEIGHT_MM,
          zMm: layout.slots[index].zMm,
          terminalGroups: barTerminalGroups(bars),
        }))
      : [];

  return {
    version: 1,
    interior: { widthMm, heightMm, depthMm },
    rails: Array.from({ length: rails.count }, (_, index) => ({
      xMm: Math.floor((widthMm - railLengthMm) / 2),
      yMm: railTop + index * RAIL_PITCH_MM,
      lengthMm: railLengthMm,
    })),
    entries: [
      { side: "top", offsetMm: entryOffset, lengthMm: widthMm - 2 * entryOffset },
      { side: "bottom", offsetMm: entryOffset, lengthMm: widthMm - 2 * entryOffset },
    ],
    bars: geometryBars,
  };
}
