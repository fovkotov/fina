import type { NextConfig } from "next";

/** На GitHub Pages сайт живёт в подпапке репозитория и раздаётся как статика. */
const isPages = process.env.GITHUB_PAGES === "true";
/** На Cloudflare Worker — статика с корня своего домена (без /fina). */
const isCf = process.env.CLOUDFLARE === "true";
const basePath = isPages ? (process.env.PAGES_BASE_PATH ?? "/fina") : "";

const nextConfig: NextConfig =
  isPages || isCf
    ? {
        output: "export",
        ...(basePath ? { basePath, assetPrefix: basePath } : {}),
        images: { unoptimized: true },
        trailingSlash: true,
        // next/image не подставляет basePath в неоптимизированные src — делаем это сами
        env: { NEXT_PUBLIC_BASE_PATH: basePath },
      }
    : { env: { NEXT_PUBLIC_BASE_PATH: "" } };

export default nextConfig;
