# Aftercare: Architecture & Technical Design

## 1. The Industry and Why

Standard retail payment assumptions break down completely in healthcare because the price is unknown at the point of service. While a standard credit card authorization holds for roughly seven days, payer adjudication takes anywhere from fifteen to forty-five days. Any architecture attempting to pre-authorize an estimated amount at check-in and capture it post-adjudication fails because the authorization expires long before the payer responds. 

That single timeline mismatch dictates the foundational rule of this architecture: **authorization and collection must be separated entirely.** 

Aftercare abandons extended auth holds in favor of generating statements post-adjudication and executing fresh, customer-initiated transactions against final, verified balances. The timeline argument is set out in [`docs/DOMAIN.md`](docs/DOMAIN.md) section 2.

---

## 2. Required Flows

Healthcare billing requires specialized flows that standard retail payment gateways do not natively package:

* **Post-Adjudication Balance Payment:** The primary volume driver. The patient receives a statement detailing the billed amount, allowed adjustments, insurance payments, and final residual responsibility.
* **Split Tender for Finite Health Accounts:** Health savings (HSA) and flexible spending (FSA) accounts are frequently insufficient to cover an entire balance. Patients require a split-tender mechanism to cover an eligible portion via a health card and settle the remainder via a secondary personal tender.
* **Re-Adjudication Partial Refunds:** Payers frequently re-process claims months later, leading to overpayments. The system must support partial refunds mapped strictly back to original payment methods.
* **Decline Management:** Because medical bills carry high emotional friction and large ticket sizes, a card decline halts collection permanently if not handled correctly. Normalizing error codes and providing immediate, tender-aware alternatives is critical to prevent drop-off.

---

## 3. Integration Approach & Payment Method Choices

### Unified Checkout vs. Hosted Payment Links
Retail solutions often rely on hosted payment links. In healthcare, **the bill explanation is the product**. Handing a patient off to a blind redirect strips away the itemized adjudication breakdown (allowed amounts, plan payments, and residual logic), triggering billing office calls and downstream disputes. 

* **The Choice:** **Unified Checkout (Web SDK)** was chosen over hosted links. It grants full UI control over the statement and adjudication display while embedding secure, processor-hosted iframes for card entry.
* **Compliance Posture:** By utilizing Unified Checkout, the application server never touches raw cardholder data (PAN), maintaining strict **SAQ A PCI compliance** without assuming the heavy burdens of SAQ D. See [`docs/DESIGN.md`](docs/DESIGN.md) section 3.

### Treating HSA/FSA as a BIN Classification Problem
No major processor exposes HSA or FSA as a standalone payment method because they are ordinary Visa/Mastercard credentials issued against custodial accounts. 
* **The Choice:** Rather than utilizing a fake connector integration, health account recognition is implemented as a **Bank Identification Number (BIN) classification layer**. The application detects the card type at runtime, adapts the interface to highlight eligible items, and constrains refund routing to satisfy IRS tax regulations (preventing taxable distributions back to personal cards).

### Keeping Clinical Data Out of the Payment Rail

PCI is the compliance axis every e-commerce checkout shares. HIPAA is the one that makes this vertical different, and it constrains the architecture harder, because a payment processor is not a business associate for treatment data and a card statement is read by whoever opens the mail.

* **The Choice:** Payments carry an **opaque statement reference** and nothing else. The reference resolves to a patient, a date of service, and line-item detail only inside this application. Nothing clinical reaches the processor in metadata, in the payment description, or in the statement descriptor, which is fixed at `NORTHGATE HEALTH` and names the provider group rather than the care.
* **Why It Is Structural:** The constraint is enforced at the type boundary rather than by convention. The input type the payment client accepts has no field capable of carrying clinical data, and the patient record itself holds an identifier, a display name, and a date of birth with no diagnosis or procedure anywhere in it. A future call site cannot leak what the types do not carry.
* **The Cost:** Support and reconciliation lose the ability to answer "what was this charge for" from the processor dashboard alone. That join happens in the application, which is the correct place for it and is a real operational trade rather than a free win.

### Deliberate Exclusions (BNPL)
General-purpose Buy-Now-Pay-Later (BNPL) products are intentionally excluded. Applying consumer lending frameworks to medical debt, where patients do not set the price, invites severe regulatory scrutiny. Internal, zero-interest provider payment plans serve this patient need without exposing them to predatory lending terms.

---

## 4. What Was Built vs. Deferred

The full deferral list, with the reasoning and the approach each would take, is in [`docs/SCOPE.md`](docs/SCOPE.md).

| Capability | Status | Architectural Approach & Reasoning |
|---|---|---|
| **Guest Statement Lookup** | Built | Avoids forced account creation, eliminating a major drop-off vector. Lookup is protected by statement reference and date of birth via a `POST` request (preventing DOB leakage in URLs), issuing a signed httpOnly access cookie. |
| **Itemized Bill Presentation** | Built | Transparent breakdown of payer adjustments, plan payments, and residual balances per line item. |
| **Card Processing** | Built | Standard card paths via Unified Checkout, with 3DS handled by redirect. |
| **Bank Debit (ACH)** | Connector configured, untested | Modelled rather than exercised. A succeeded debit derives a provisional `settling` state for a 5-day return window instead of `paid`, and the receipt says so, but no ACH payment has been run end to end and no returned-debit event is consumed. |
| **Health Account Recognition & Split Tender** | Built | BIN-based classification allowing partial coverage across multiple tenders, with health account refunds drawn down last to safeguard tax rules. |
| **Verified Webhook Ingestion** | Built | Cryptographically secure (HMAC-SHA512 via `x-webhook-signature-512`) append-only ledger guaranteeing money state independent of browser redirects, with duplicate suppression on `event_id` and out-of-order protection via processor timestamps. |
| **Readjudication Partial Refunds** | Built | Automated routing back to the original tender (with health account funds drawn down last to protect tax status) driven by provider re-adjudication endpoints. |
| **Risk Controls & Fraud Guard** | Built | Card-testing signals derived from the payment ledger, presented beside the live Hyperswitch blocklist and the active routing algorithm read from the account rather than mirrored locally. |
| **Processor Reconciliation** | Built | A webhook that never arrives is repaired by querying the processor directly, since polling a ledger that only a webhook can move cannot resolve a missing webhook. |
| **Normalized Decline Handling** | Built | Tender-aware error categorization distinguishing insufficient personal funds from health account card limits, presenting contextual next steps. |
| **Automated Payment Plans & Dunning** | Deferred | Requires complex offline mandates and recovery engines that cannot be meaningfully verified in a stateless sandbox. |
| **Real IIAS Auto-Substantiation** | Deferred | Requires organizational SIGIS registration and certified inventory integrations rather than pure software logic. |
| **Second Connector & Live Routing** | Deferred | The strongest case for an orchestration layer is processor plurality, failover, and least-cost routing on regulated debit. One connector demonstrates none of them. A routing algorithm is configured and readable on the account, but with a single processor to choose from it is a shape rather than a decision. |
| **Rate Limiting on Statement Lookup** | Deferred | A statement reference plus a date of birth is a deliberately weak credential, chosen because it is what a patient holding a paper bill actually has. Failed lookups are counted and surfaced in the risk console; the throttle that would act on them is the missing control. |
| **Dispute & Chargeback Workflow** | Deferred | Representment requires evidence assembly from the practice management system, which is the integration this prototype explicitly excludes. |

---

## 5. End-to-End Prototype Flow & Invariants

Every choice below, including the ones that were wrong first, is recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md). The build session itself is in [`ai-sessions/`](ai-sessions/).

1. **Statement Lookup & Cookie Grant:** The patient submits their statement reference and date of birth via `POST /api/statements/lookup`. The server validates credentials and issues a signed, domain-separated httpOnly cookie (`aftercare_access`) that scopes access exclusively to that single statement.
2. **Portion Selection & Intent Creation:** The patient selects a payment portion (`"full"` or `"health_account"`). The server calculates the exact amount to prevent client-side floating-point unit injection bugs (e.g., passing raw floats as cents), then creates or reuses a live processor intent via `POST /api/payments/intent`.
3. **Client-Side SDK Confirmation:** The Hyperswitch Web SDK mounts an isolated iframe for card entry. Confirmation happens directly between the browser and the processor, triggering 3DS redirects if required without exposing PAN data to the application server.
4. **Webhook Ingestion & Immutable Ledger Append:** Cryptographically verified webhooks (`POST /api/webhooks/hyperswitch`) arrive with HMAC-SHA512 signatures, check idempotency claims against `event_id` to prevent retry loops, and append immutable observation rows to the append-only event log.
5. **Dynamic State Folding:** Statement statuses and remaining balances are never mutated in place. Instead, they are dynamically derived at read-time by folding processor records by unique IDs (newest `updatedAt` timestamp wins), ensuring complete alignment between the ledger and reality.
6. **Reconciliation & Return Polling:** The return page polls derived statement statuses with a bounded backoff, supported by a direct processor query reconciliation path (`POST /api/statements/reconcile`) to safely repair missing webhooks without breaking ordering invariants.