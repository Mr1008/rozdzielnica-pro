/**
 * Single entry point for user-facing text.
 *
 * Import `t` in `.astro` frontmatter and in React islands alike — it is a plain
 * module, so islands need no provider and no context. Never inline a
 * user-facing string in a component; add a key here instead.
 *
 * Adding a second locale later:
 *   1. write `src/lib/i18n/en.ts` as `export const en: Messages = { ... }`
 *      (the compiler will list every key you missed),
 *   2. replace the export below with a lookup keyed by the request's locale.
 * Nothing else in the app has to change.
 */
export { pl as t } from "./pl";
export type { Messages } from "./pl";

export {
  LOCALE,
  CURRENCY,
  plural,
  formatMoney,
  formatNumber,
  formatDate,
  formatDateTime,
  type PluralForms,
} from "./format";
