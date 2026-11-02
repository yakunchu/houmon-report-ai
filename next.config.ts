import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 同じ Wi-Fi のスマホから開発サーバーを開くため。Next.js は localhost 以外のオリジンからの /_next/* を
  // ブロックするので、PC の LAN IP と 192.168.1.0/24 を許可する（「*」はホスト名の 1 ラベル＝IP では 1 オクテット）。
  // 本番ビルドには影響しない（開発サーバーだけの設定）。
  allowedDevOrigins: ["192.168.1.112", "192.168.1.*"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
