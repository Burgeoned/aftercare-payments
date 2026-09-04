import "server-only";

import { deriveBalance } from "./balance";
import {
  findPatientById,
  findStatementByRef,
  paymentsForStatement,
  refundsForPayments,
} from "./store";
import type { Result, Statement, StatementBalance } from "./types";

/**
 * Guest statement lookup.
 *
 * No account, no password, no email verification. A patient holding a paper
 * statement types the reference printed on it and their date of birth. Forcing
 * account creation in front of a medical bill is the single largest source of
 * abandonment in this vertical, see docs/DOMAIN.md section 8, so the design
 * accepts a weaker credential in exchange for the patient actually paying.
 *
 * The weaker credential is what the rest of this module is about.
 */

export interface StatementView {
  readonly statement: Statement;
  readonly patientDisplayName: string;
  readonly balance: StatementBalance;
}

export type LookupError =
  | { readonly kind: "not_found" }
  | { readonly kind: "malformed_input"; readonly field: "ref" | "dateOfBirth" };

const DOB_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Compares two strings in time independent of where they first differ.
 *
 * A date of birth has few enough possibilities that a timing oracle is a real
 * shortcut for an attacker who already has a statement reference. This is cheap
 * and the argument for skipping it is only that it feels excessive.
 */
function equalsInConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Resolves a statement, or reports that it could not be resolved.
 *
 * A missing reference and a wrong date of birth return the identical error on
 * purpose. Distinguishing them turns this endpoint into an oracle for which
 * statement references exist, and a valid reference is most of what an attacker
 * needs. The patient-facing message is correspondingly vague, which is a real
 * usability cost taken deliberately.
 *
 * Not built, and it should be before this is public: rate limiting per address
 * and per reference. Both parts of this credential are guessable given enough
 * attempts, and nothing here slows an attacker down. See docs/SCOPE.md.
 */
export async function lookupStatement(
  ref: string,
  dateOfBirth: string,
): Promise<Result<StatementView, LookupError>> {
  if (ref.trim() === "") {
    return { ok: false, error: { kind: "malformed_input", field: "ref" } };
  }

  if (!DOB_PATTERN.test(dateOfBirth)) {
    return { ok: false, error: { kind: "malformed_input", field: "dateOfBirth" } };
  }

  const statement = findStatementByRef(ref);
  if (statement === null) {
    return { ok: false, error: { kind: "not_found" } };
  }

  const patient = findPatientById(statement.patientId);
  if (patient === null) {
    // A statement pointing at a patient who does not exist is a broken fixture,
    // not a failed lookup. It is reported as not found rather than crashing,
    // because a patient should never see a stack trace on a billing page.
    return { ok: false, error: { kind: "not_found" } };
  }

  if (!equalsInConstantTime(patient.dateOfBirth, dateOfBirth)) {
    return { ok: false, error: { kind: "not_found" } };
  }

  return { ok: true, value: await buildView(statement, patient.displayName) };
}

/** Used once access has already been granted, so it takes no credential. */
export async function viewStatement(statement: Statement): Promise<StatementView | null> {
  const patient = findPatientById(statement.patientId);
  if (patient === null) return null;
  return await buildView(statement, patient.displayName);
}

async function buildView(
  statement: Statement,
  patientDisplayName: string,
): Promise<StatementView> {
  const payments = await paymentsForStatement(statement.id);
  const refunds = await refundsForPayments(payments.map((p) => p.id));

  return {
    statement,
    patientDisplayName,
    balance: deriveBalance(statement, payments, refunds),
  };
}
