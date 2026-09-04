import type { Metadata } from "next";
import { IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";

import "./globals.css";

/**
 * Two families, one per ground, per the split in globals.css.
 *
 * The grotesque carries the instrument: figures read off a panel, controls,
 * labels. Plex has real tabular numerals, which matters when an amount changes
 * under the patient and the layout must not move.
 *
 * The serif carries the document. An explanation of benefits is a printed
 * artifact and a patient has seen a hundred of them on paper. Source Serif is
 * drawn for reading on screen rather than for display, so it holds up at body
 * size across a table of line items.
 */

const instrument = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-instrument",
  display: "swap",
});

const documentFace = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-document",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aftercare",
  description: "Pay a medical bill",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrument.variable} ${documentFace.variable}`}>
      <body>{children}</body>
    </html>
  );
}
