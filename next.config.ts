import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Fail the production build on a type error rather than shipping it. A
  // prototype that deploys broken is worse than one that refuses to deploy.
  // Linting is enforced by `npm run verify` and by CI, not by the build:
  // Next 16 dropped the `eslint` key from NextConfig.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
