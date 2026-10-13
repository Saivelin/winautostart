/**
 * Numeric input sanitizing. The backend model uses unsigned ints (`u32`/`u64`),
 * and a value outside that range makes the whole `save_config` call fail on
 * deserialization — so a typed `-1` has to be clamped here, at the input,
 * rather than silently losing the config later.
 */

/** Whole number from a raw input value, clamped into `[min, max]`; junk → `min`. */
export function parseBoundedInt(raw: string, min: number, max: number): number {
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) return min;
  // Infinity survives the clamp on purpose: an absurd number lands on `max`,
  // which is friendlier than snapping back to the minimum.
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
