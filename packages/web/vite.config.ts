import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "path";
import runableAnalyticsPlugin from "./vite/__plugins/runable-analytics-plugin";
import honoDevPlugin from "./vite/__plugins/hono-dev-plugin";
import assetOptimizerPlugin from "./vite/__plugins/asset-optimizer-plugin";
import ports from "../../__ports.cjs";
import { VitePWA } from "vite-plugin-pwa";

const root = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  Object.assign(process.env, env);

  return {
    // All env files live at the repo root — keep Vite's own env loading there too,
    // so packages/web/.env* files can never shadow the root .env.
    envDir: root,
    plugins: [
      honoDevPlugin(),
      react(),
      runableAnalyticsPlugin(),
      tailwind(),
      assetOptimizerPlugin(),
      VitePWA({
        registerType: "autoUpdate",
        includeManifestIcons: false,
        manifest: {
          name: "Raw Material STOCK BUILDING",
          short_name: "RM-SB",
          description: "Pilotage local des réceptions de matières premières",
          lang: "fr",
          theme_color: "#092c40",
          background_color: "#f5f7f8",
          display: "standalone",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "/images/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            {
              src: "/images/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,png,woff2,ico}"],
          maximumFileSizeToCacheInBytes: 8000000,
          navigateFallback: "/index.html",
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin && !url.pathname.startsWith("/api/"),
              handler: "NetworkFirst",
              options: {
                cacheName: "rm-sb-local-assets-v3",
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 300, maxAgeSeconds: 2592000 },
              },
            },
          ],
        },
        devOptions: { enabled: true, type: "module" },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src/web"),
      },
    },
    server: {
      port: ports.website,
      strictPort: true,
      allowedHosts: true,
      hmr: { overlay: false },
      cors: false,
    },
  };
});
