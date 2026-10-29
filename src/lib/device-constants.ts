/**
 * The device value lists the browser needs (the catalog filter script orders by them), kept free of
 * dependencies so importing them never ships the device parser, zod or the Polish dictionary to the
 * client. `device-spec.ts` re-exports them; its CHECK-parity rules still own what the values mean.
 */

export const POLE_CONFIGS = ["1P", "1P+N", "2P", "3P", "3P+N", "4P"] as const;
export type PoleConfig = (typeof POLE_CONFIGS)[number];

export const RCD_TYPES = ["AC", "A", "F", "B"] as const;
export type RcdType = (typeof RCD_TYPES)[number];
