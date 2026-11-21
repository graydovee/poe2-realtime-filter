import { readFileSync } from "node:fs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version },
  output: "export",
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
