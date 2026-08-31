/**
 * Declaration shim for @juspay-tech/react-hyper-js.
 *
 * The published package (2.3.0) sets `main: dist/bundle.js` and ships no
 * `types` field and no `.d.ts`, so under `strict` it resolves as an implicit
 * any and the build fails. Its sibling `@juspay-tech/hyper-js` does ship types
 * at `dist/index.d.ts` via its exports map and needs no shim.
 *
 * This declares only the surface this prototype uses. It is deliberately narrow:
 * a wider guess would be a fabricated API contract, and a wrong shim is worse
 * than a missing one because it fails at runtime instead of at compile time.
 *
 * See docs/DECISIONS.md D-002.
 */
declare module "@juspay-tech/react-hyper-js" {
  import type { ReactNode } from "react";

  export interface HyperElementsOptions {
    readonly clientSecret: string;
    readonly appearance?: Record<string, unknown>;
    readonly locale?: string;
  }

  export interface HyperElementsProps {
    readonly hyper: Promise<Hyper | null>;
    readonly options: HyperElementsOptions;
    readonly children: ReactNode;
  }

  export function HyperElements(props: HyperElementsProps): JSX.Element;

  export interface UnifiedCheckoutProps {
    readonly id?: string;
    readonly options?: Record<string, unknown>;
  }

  export function UnifiedCheckout(props: UnifiedCheckoutProps): JSX.Element;

  export interface ConfirmPaymentArgs {
    readonly elements: Widgets;
    readonly confirmParams: { readonly return_url: string };
    /**
     * "always" performs a full-page redirect on completion. "if_required" keeps
     * the customer on the page unless the payment method demands a redirect,
     * which 3DS does.
     */
    readonly redirect?: "always" | "if_required";
  }

  export interface ConfirmPaymentResult {
    readonly error?: { readonly message?: string; readonly type?: string };
    readonly status?: string;
  }

  export interface Hyper {
    confirmPayment(args: ConfirmPaymentArgs): Promise<ConfirmPaymentResult>;
    retrievePaymentIntent(clientSecret: string): Promise<unknown>;
  }

  /** Opaque handle to the mounted widget collection. */
  export type Widgets = unknown;

  export function useHyper(): Hyper | null;
  export function useWidgets(): Widgets | null;
}
