/**
 * DIN modules (TE, "moduły") ↔ millimetres. Devices are stored in millimetres; the editor lets the
 * admin type either unit and the list shows both, so the conversion lives in one place.
 */

/** The width of one DIN module (1 TE). */
export const DIN_MODULE_MM = 17.5;

/** The finest module step the editor offers. */
const MODULE_STEP = 0.5;
const STEP_MM = DIN_MODULE_MM * MODULE_STEP;

export function mmFromModules(modules: number): number {
  return modules * DIN_MODULE_MM;
}

/**
 * A width in millimetres as a module count in 0.5 steps, or `null` when it is not a whole number of
 * half-modules (a multiple of 8.75 mm) — so the list falls back to showing millimetres only.
 */
export function modulesFromMm(mm: number): number | null {
  if (!Number.isFinite(mm) || mm <= 0) return null;
  const steps = mm / STEP_MM;
  const whole = Math.round(steps);
  if (Math.abs(steps - whole) > 1e-9) return null;
  return whole * MODULE_STEP;
}
