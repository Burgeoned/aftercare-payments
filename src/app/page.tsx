import { PATIENTS, PROVIDER_NAME, STATEMENTS } from "@/lib/domain/fixtures";
import { LookupForm } from "./lookup-form";

/**
 * Guest lookup. No account, no password, no email verification.
 *
 * Requiring account creation in front of a medical bill is the single largest
 * source of abandonment in this vertical, so the patient gets in with what is
 * printed on the paper they are holding. See docs/DOMAIN.md section 8 and the
 * security tradeoff recorded in src/lib/domain/lookup.ts.
 *
 * The form sits on the instrument ground because it is the thing being
 * operated. Everything explaining the prototype sits on the document ground
 * below it.
 */

export default function Home() {
  return (
    <>
      <section className="instrument">
        <div className="wrap wrap-narrow" style={{ paddingTop: "4.5rem", paddingBottom: "4rem" }}>
          <p className="eyebrow">{PROVIDER_NAME} &middot; Patient billing</p>

          <h1 className="hero-title mixed" style={{ margin: "1rem 0 0.6rem" }}>
            Pay your bill
            <em>without making an account.</em>
          </h1>

          <p className="muted lede" style={{ marginBottom: "2.5rem" }}>
            Enter the reference from your statement and your date of birth.
          </p>

          <LookupForm />
        </div>
      </section>

      <section className="document">
        <div className="wrap wrap-narrow" style={{ paddingTop: "3.5rem", paddingBottom: "4.5rem" }}>
          <div className="stack">
            <div>
              <p className="eyebrow">Prototype &middot; Fixture data</p>
              <h2 className="section-title" style={{ margin: "0.75rem 0 0.75rem" }}>
                There is no practice management system behind this.
              </h2>
              <p className="muted lede">
                Three statements exist, with adjudication figures that reconcile the way a
                real remittance does. Use any of them.
              </p>

              <table className="table" style={{ minWidth: 0, marginTop: "1.5rem" }}>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th className="n">Date of birth</th>
                  </tr>
                </thead>
                <tbody>
                  {STATEMENTS.map((statement) => {
                    const patient = PATIENTS.find((p) => p.id === statement.patientId);
                    return (
                      <tr key={statement.id}>
                        <td className="num">{statement.ref}</td>
                        <td className="n">{patient?.dateOfBirth}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="note">
              A statement reference plus a date of birth is a deliberately weak credential.
              It is what a patient holding a paper bill actually has, and the alternative,
              an account, is where most of them stop paying. Rate limiting is the missing
              control and is recorded as such rather than quietly skipped.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
