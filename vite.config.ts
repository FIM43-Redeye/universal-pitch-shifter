import { defineConfig } from "vite";
import { resolve } from "path";
import webExtension from "vite-plugin-web-extension";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  root: "src",
  plugins: [
    webExtension({
      manifest: "manifest.json",
      additionalInputs: [
        "content/bridge.ts",
        "worklet/rubberband-processor.ts",
        "worklet/soundtouch-processor.ts",
      ],
    }),
    viteStaticCopy({
      targets: [
        {
          src: "wasm/*.wasm",
          dest: "wasm",
        },
        {
          src: "icons/*",
          dest: "icons",
        },
      ],
    }),
  ],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: process.env.NODE_ENV === "development",
  },
});
