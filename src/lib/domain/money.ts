/**
 * Arithmetic over `Cents`.
 *
 * Separate from `types.ts` because that file is the interface contract and is
 * changed deliberately. This is the operations layer over the primitive it
 * defines, and it exists so that no module has to unbrand a `Cents` to add two
 * of them together. Every function here returns a `Cents`, so a sum cannot
 * decay into a plain number partway through a calculation.
 */

import { cents, type Cents } from "./types";

export const ZERO: Cents = cents(0);

export function add(a: Cents, b: Cents): Cents {
  return cents(a + b);
}

export function subtract(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

export function sum(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const value of values) total += value;
  return cents(total);
}

/**
 * A negative balance is an arithmetic error somewhere upstream, but showing a
 * patient a negative number on a bill is a worse failure than showing zero.
 * Callers that need to know the difference check for it before clamping rather
 * than inferring it from the clamped value.
 */
export function clampToZero(value: Cents): Cents {
  return value < 0 ? ZERO : value;
}

/** Display only. The float division never re-enters a calculation. */
export function formatUsd(value: Cents): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}
