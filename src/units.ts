/**
 * Unit conventions.
 *
 * The command system works in inches (the app's default unit — real-world
 * imperial framing dimensions). Convert only at input/display boundaries,
 * never inside geometry code.
 */

export const INCHES_PER_FOOT = 12;
export const INCHES_PER_METER = 39.3701;

/** Convert inches to feet, e.g. for readable logs/HUD output. */
export function inchesToFeet(inches: number): string {
  const ft = Math.round(inches / INCHES_PER_FOOT);
  const rem = inches - ft * INCHES_PER_FOOT;
  return rem === 0 ? `${ft}'` : `${ft}' ${rem}"`;
}