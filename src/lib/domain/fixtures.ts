/**
 * Fixture data standing in for a practice management system.
 *
 * Every amount is what an 835 remittance would actually carry, which is why the
 * shape of `LineItem` matches an 835 rather than something more convenient. See
 * docs/SCOPE.md item 8 for where this data comes from in production.
 *
 * One invariant holds on every line and is asserted by a test rather than
 * trusted: `allowed === payerPaid + patientOwes`. An adjudicated line where
 * those do not reconcile is not a line a payer produced, and fixture data that
 * quietly breaks the arithmetic makes every balance derived from it meaningless.
 *
 * The non-covered line in AFT-4108-2290 is the exception that proves the rule.
 * Its allowed amount equals its charge, because a payer that denies coverage
 * adjudicates no benefit and therefore applies no contractual adjustment. The
 * patient owes the full charge. That is the correct modelling, and getting it
 * wrong is how a bill ends up showing a discount the patient did not receive.
 */

import { cents, type LineItem, type Patient, type Statement } from "./types";

export const PROVIDER_NAME = "Northgate Health Partners";

/**
 * The statement descriptor a patient sees on a card statement. Deliberately the
 * provider group name and nothing else: no department, no service line, no
 * procedure. See docs/DESIGN.md section 10.
 */
export const STATEMENT_DESCRIPTOR = "NORTHGATE HEALTH";

export const PATIENTS: readonly Patient[] = [
  {
    id: "pat_dwhitfield",
    displayName: "Dana Whitfield",
    dateOfBirth: "1988-03-14",
    guarantorId: null,
  },
  {
    id: "pat_moyelaran",
    displayName: "Marcus Oyelaran",
    dateOfBirth: "1975-11-02",
    guarantorId: null,
  },
  {
    id: "pat_praghunathan",
    displayName: "Priya Raghunathan",
    dateOfBirth: "1962-05-27",
    guarantorId: null,
  },
];

function line(
  id: string,
  description: string,
  charged: number,
  allowed: number,
  payerPaid: number,
  patientOwes: number,
  healthAccountEligible: boolean,
): LineItem {
  return {
    id,
    description,
    charged: cents(charged),
    allowed: cents(allowed),
    payerPaid: cents(payerPaid),
    patientOwes: cents(patientOwes),
    healthAccountEligible,
  };
}

export const STATEMENTS: readonly Statement[] = [
  /**
   * Routine visit, benefits applied, coinsurance only. The ordinary case, and
   * the one where the payer adjustment is the most striking: the patient sees a
   * $334.00 charge resolve to $32.70 owed.
   */
  {
    id: "stmt_4021",
    ref: "AFT-4021-8837",
    patientId: "pat_dwhitfield",
    serviceDate: "2026-07-08",
    issuedAt: "2026-08-04T14:02:00.000Z",
    currency: "USD",
    lineItems: [
      line("li_4021_1", "Office visit, established patient", 24500, 13200, 10560, 2640, true),
      line("li_4021_2", "Comprehensive metabolic panel", 8900, 3150, 2520, 630, true),
    ],
  },

  /**
   * Deductible not yet met, so the payer allowed the charges and paid none of
   * them, plus one non-covered elective line. This is the statement that
   * exercises mixed health account eligibility: the imaging is eligible, the
   * cosmetic consult is not, and a patient paying with an FSA card can only
   * apply those funds to part of the balance.
   */
  {
    id: "stmt_4108",
    ref: "AFT-4108-2290",
    patientId: "pat_moyelaran",
    serviceDate: "2026-06-19",
    issuedAt: "2026-07-22T14:02:00.000Z",
    currency: "USD",
    lineItems: [
      line("li_4108_1", "MRI, lumbar spine, without contrast", 142000, 58400, 0, 58400, true),
      line("li_4108_2", "Radiology interpretation", 31000, 11800, 0, 11800, true),
      line("li_4108_3", "Cosmetic consultation, not covered", 22500, 22500, 0, 22500, false),
    ],
  },

  /**
   * Outpatient surgery. At $1,639.00 this is the payment plan candidate: past
   * the point where a single card charge is realistic for most patients, which
   * is the threshold that makes installments the interesting flow. Payment
   * plans are deferred, see docs/SCOPE.md item 1, so this statement exists to
   * show the balance that would trigger one rather than to run one.
   */
  {
    id: "stmt_3994",
    ref: "AFT-3994-1177",
    patientId: "pat_praghunathan",
    serviceDate: "2026-05-27",
    issuedAt: "2026-07-01T14:02:00.000Z",
    currency: "USD",
    lineItems: [
      line("li_3994_1", "Ambulatory surgery center facility fee", 1284000, 412000, 289600, 122400, true),
      line("li_3994_2", "Surgeon professional fee", 385000, 128000, 102400, 25600, true),
      line("li_3994_3", "Anesthesia services", 176000, 61500, 49200, 12300, true),
      line("li_3994_4", "Pathology, surgical specimen", 42000, 18000, 14400, 3600, true),
    ],
  },
];
