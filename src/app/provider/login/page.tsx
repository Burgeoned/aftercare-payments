import { PROVIDER_NAME } from "@/lib/domain/fixtures";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function ProviderLoginPage() {
  return (
    <main className="instrument" style={{ minHeight: "100vh" }}>
      <div className="wrap wrap-narrow" style={{ paddingTop: "4.5rem", paddingBottom: "4rem" }}>
        <p className="eyebrow">{PROVIDER_NAME} &middot; Billing office</p>
        <h1 className="hero-title mixed" style={{ margin: "1rem 0 0.6rem" }}>
          Staff sign in
          <em>this console moves money.</em>
        </h1>
        <p className="muted lede" style={{ marginBottom: "2.5rem" }}>
          The provider surface issues refunds and controls the fraud blocklist. A shared
          password is not per-user identity, which is still deferred, but it is a real
          secret rather than a door left open.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
