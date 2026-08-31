// eslint-config-next 16 ships a native flat config array, so it is spread
// directly. The FlatCompat shim is not needed and in fact fails against it.
// See docs/DECISIONS.md D-003.
import coreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...coreWebVitals,
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
];

export default config;
