import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": new URL("./src/", import.meta.url).pathname,
      /**
       * `server-only` throws on import unless Node resolves it under the
       * react-server condition, and Vitest externalizes the package before any
       * condition applies. This points at the package's own react-server entry,
       * which is what Next resolves to at build time, so the tests load these
       * modules the same way the application does instead of stubbing the
       * marker out.
       */
      "server-only": new URL("./node_modules/server-only/empty.js", import.meta.url).pathname,
    },
  },
});
