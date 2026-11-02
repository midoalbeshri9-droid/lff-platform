import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "exceljs", "bcryptjs", "@electric-sql/pglite"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  poweredByHeader: false,
};
export default nextConfig;
