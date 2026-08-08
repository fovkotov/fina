import type { NextConfig } from "next";

/** На GitHub Pages сайт живёт в подпапке репозитория и раздаётся как статика. */
const isPages = process.env.GITHUB_PAGES === "true";
const basePath = process.env.PAGES_BASE_PATH ?? "/fina";

const nextConfig: NextConfig = isPages
  ? {
      output: "export",
      basePath,
      assetPrefix: basePath,
      images: { unoptimized: true },
      trailingSlash: true,
      // next/image не подставляет basePath в неоптимизированные src — делаем это сами
      env: { NEXT_PUBLIC_BASE_PATH: basePath },
    }
  : { env: { NEXT_PUBLIC_BASE_PATH: "" } };

export default nextConfig;
