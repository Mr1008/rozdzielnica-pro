// Rasterises the brand mark into the static assets in `public/`. Dev-time tool: run it with
// `npm run brand:assets` after editing `src/assets/brand/mark.svg` or the brand tokens, and commit
// what it writes.
//
//   public/favicon.svg          the small mark (mark-small.svg) with its colours resolved
//   public/favicon.png          32×32, the small mark
//   public/apple-touch-icon.png 180×180, the full mark on a paper tile
//   public/og-image.png         1200×630, hero register: the mark and the brand name, nothing to translate
//
// `sharp` is not a direct dependency: it is installed with `astro` (image service) and only this
// script uses it. Every output's dimensions are read back and the script exits non-zero on a mismatch.
//
// No colour is written here. Every colour is read at run time from the `:root` tokens in
// `src/styles/global.css` (the single colour source), because an asset outside the page cannot read
// CSS custom properties. `favicon.svg` gets the token values verbatim (browsers render oklch); the
// PNGs go through librsvg, which does not, so they get the same values converted to sRGB hex. The
// brand name comes from `t.app.wordmark` in `src/lib/i18n/pl.ts`.
//
// Before rendering, every SVG under `src/assets/brand` is checked to be well-formed XML: no "--"
// inside a comment (illegal in XML), balanced tags, and parseable by librsvg. The script fails
// otherwise.

import { Buffer } from "node:buffer";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const brandDir = path.join(root, "src/assets/brand");
const masterPath = path.join(brandDir, "mark.svg");
const smallPath = path.join(brandDir, "mark-small.svg");
const globalCssPath = path.join(root, "src/styles/global.css");
const messagesPath = path.join(root, "src/lib/i18n/pl.ts");
const publicDir = path.join(root, "public");

function fail(message) {
  console.error(`brand-assets: ${message}`);
  process.exit(1);
}

// ---- Tokens ---------------------------------------------------------------------------------------

/** The `--name: oklch(…);` declarations of the `:root` block, by name. */
function readRootTokens(css) {
  const block = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!block) fail("no :root block in global.css");
  const found = new Map();
  for (const match of block[1].matchAll(/(--[\w-]+):\s*(oklch\([^)]*\))\s*;/g)) found.set(match[1], match[2]);
  return found;
}

/** `oklch(L[%] C H [/ A[%]])` → numbers, L and A as fractions. */
function parseOklch(value) {
  const match = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(value);
  if (!match) fail(`cannot parse colour ${value}`);
  const [, l, lPercent, c, h, a, aPercent] = match;
  return {
    l: Number(l) / (lPercent ? 100 : 1),
    c: Number(c),
    h: Number(h),
    alpha: a === undefined ? 1 : Number(a) / (aPercent ? 100 : 1),
  };
}

/** OKLCH → sRGB hex via Björn Ottosson's OKLab matrices, clipped to the sRGB gamut. */
function oklchToHex({ l, c, h }) {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  const linear = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ];
  const channels = linear.map((value) => {
    const clipped = Math.min(1, Math.max(0, value));
    const encoded = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

const tokens = readRootTokens(await readFile(globalCssPath, "utf8"));

/** A token as `{ css, hex, alpha }`: the verbatim value for browsers, sRGB hex + opacity for librsvg. */
function token(name) {
  const css = tokens.get(name);
  if (css === undefined) fail(`token ${name} not found in the global.css :root block`);
  const parsed = parseOklch(css);
  return { css, hex: oklchToHex(parsed), alpha: parsed.alpha };
}

const COLOURS = {
  paper: token("--background"),
  ink: token("--foreground"),
  primary: token("--primary"),
  onPrimary: token("--primary-foreground"),
  heroBackground: token("--hero-background"),
  heroForeground: token("--hero-foreground"),
  heroCurrent: token("--hero-current"),
  heroGrid: token("--hero-grid"),
};

// ---- Brand name -----------------------------------------------------------------------------------

const wordmark = /wordmark:\s*\{\s*lead:\s*"([^"]+)",\s*accent:\s*"([^"]+)"/.exec(await readFile(messagesPath, "utf8"));
if (!wordmark) fail("t.app.wordmark not found in pl.ts");
const [, BRAND_LEAD, BRAND_ACCENT] = wordmark;
const BRAND_NAME = BRAND_LEAD + BRAND_ACCENT;

// ---- SVG well-formedness --------------------------------------------------------------------------

/** Cheap well-formedness problems: "--" in comments, unterminated comments, unbalanced tags. */
function xmlProblems(svg) {
  const problems = [];
  for (const match of svg.matchAll(/<!--([\s\S]*?)-->/g)) {
    if (match[1].includes("--") || match[1].endsWith("-")) {
      problems.push(`"--" inside the comment at offset ${String(match.index)}`);
    }
  }
  const body = svg.replace(/<!--[\s\S]*?-->/g, "");
  if (body.includes("<!--")) problems.push("unterminated comment");
  const stack = [];
  for (const match of body
    .replace(/<\?[\s\S]*?\?>/g, "")
    .matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    if (!closing) stack.push(name);
    else if (stack.pop() !== name) problems.push(`unbalanced </${name}>`);
  }
  if (stack.length > 0) problems.push(`unclosed <${stack.join(">, <")}>`);
  return problems;
}

for (const file of (await readdir(brandDir)).filter((name) => name.endsWith(".svg")).sort()) {
  const svg = await readFile(path.join(brandDir, file), "utf8");
  const problems = xmlProblems(svg);
  if (problems.length === 0) {
    try {
      await sharp(Buffer.from(svg)).metadata();
    } catch (error) {
      problems.push(`librsvg cannot parse it (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (problems.length > 0) fail(`src/assets/brand/${file} is not well-formed: ${problems.join("; ")}`);
  console.log(`checked src/assets/brand/${file}`);
}

// ---- Rendering ------------------------------------------------------------------------------------

const master = await readFile(masterPath, "utf8");
const small = await readFile(smallPath, "utf8");

/** The master's inner shapes (everything inside `<svg>`), comments dropped. */
function innerShapes(svg) {
  const inner = svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
  return inner.trim();
}

/** The mark's shapes with its two colour hooks (ink, brand current) resolved to fixed values. */
function colouredShapes(ink, current) {
  return innerShapes(master)
    .replace(/var\(--brand-current,\s*[^)]+\)/g, current)
    .replaceAll("currentColor", ink);
}

/**
 * The small mark as a square icon, `px` wide: its solid tile is the icon itself, in primary with the
 * bolt knocked out in primary-foreground. `format` picks the colour notation, as for `iconSvg`.
 */
function smallIconSvg({ px, format }) {
  const shapes = innerShapes(small)
    .replace(/var\(--brand-current,\s*[^)]+\)/g, COLOURS.primary[format])
    .replace(/var\(--brand-on-current,\s*[^)]+\)/g, COLOURS.onPrimary[format]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 16 16">
  ${shapes}
</svg>
`;
}

/**
 * A square icon, `px` wide: a paper tile with the mark in ink + primary, `inset` 32-grid units of
 * margin. `format` picks the colour notation: `css` (verbatim tokens) or `hex` (for librsvg).
 */
function iconSvg({ inset, radius, px, format }) {
  const size = 32 + inset * 2;
  const c = (colour) => colour[format];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-inset} ${-inset} ${size} ${size}" fill="none">
  <rect x="${-inset}" y="${-inset}" width="${size}" height="${size}" rx="${radius}" fill="${c(COLOURS.paper)}" />
  ${colouredShapes(c(COLOURS.ink), c(COLOURS.primary))}
</svg>
`;
}

function ogSvg() {
  const width = 1200;
  const height = 630;
  const markSize = 168;
  const gap = 40;
  const fontSize = 96;
  // Approximate text width for centring; the font is a generic fallback where Plex is not installed.
  const textWidth = BRAND_NAME.length * fontSize * 0.48;
  const groupWidth = markSize + gap + textWidth;
  const x0 = (width - groupWidth) / 2;
  const markY = (height - markSize) / 2;
  const grid = [];
  for (let x = 0; x <= width; x += 40) grid.push(`M${x} 0V${height}`);
  for (let y = 0; y <= height; y += 40) grid.push(`M0 ${y}H${width}`);
  const { heroBackground, heroGrid, heroCurrent, heroForeground } = COLOURS;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${heroBackground.hex}" />
  <path d="${grid.join("")}" stroke="${heroGrid.hex}" stroke-opacity="${heroGrid.alpha}" stroke-width="1" fill="none" />
  <path d="M0 ${height - 120}H${x0 - 40}V${height / 2}H${x0}" stroke="${heroCurrent.hex}" stroke-opacity="0.5" stroke-width="3" fill="none" />
  <svg x="${x0}" y="${markY}" width="${markSize}" height="${markSize}" viewBox="0 0 32 32" fill="none">
    ${colouredShapes(heroForeground.hex, heroCurrent.hex)}
  </svg>
  <text x="${x0 + markSize + gap}" y="${height / 2}" dominant-baseline="central" font-family="'IBM Plex Sans', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="${fontSize}" font-weight="600" fill="${heroForeground.hex}">${BRAND_LEAD}<tspan fill="${heroCurrent.hex}">${BRAND_ACCENT}</tspan></text>
</svg>
`;
}

const outputs = [
  { file: "favicon.png", svg: smallIconSvg({ px: 32, format: "hex" }), width: 32, height: 32 },
  {
    file: "apple-touch-icon.png",
    svg: iconSvg({ inset: 4, radius: 0, px: 180, format: "hex" }),
    width: 180,
    height: 180,
  },
  { file: "og-image.png", svg: ogSvg(), width: 1200, height: 630 },
];

await writeFile(
  path.join(publicDir, "favicon.svg"),
  `<!-- Generated by scripts/brand-assets.mjs from src/assets/brand/mark-small.svg and the global.css tokens. Do not edit. -->\n${smallIconSvg({ px: 32, format: "css" })}`,
);
console.log("wrote public/favicon.svg");

let failed = false;
for (const { file, svg, width, height } of outputs) {
  const target = path.join(publicDir, file);
  await sharp(Buffer.from(svg)).resize(width, height, { fit: "fill" }).png({ compressionLevel: 9 }).toFile(target);
  const meta = await sharp(target).metadata();
  const ok = meta.width === width && meta.height === height;
  if (!ok) failed = true;
  console.log(`${ok ? "wrote" : "MISMATCH"} public/${file} ${meta.width}×${meta.height} (expected ${width}×${height})`);
}

if (failed) process.exit(1);
