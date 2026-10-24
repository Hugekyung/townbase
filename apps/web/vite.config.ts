import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const localApi = {
  target: "http://127.0.0.1:3000",
  changeOrigin: false,
  xfwd: false,
};

export default defineConfig({
  plugins: [react()],
  server: {
    // Preserve the browser Host/Origin; never manufacture HTTPS/forwarded headers.
    proxy: {
      "/readyz": { ...localApi },
      "/setup": { ...localApi },
    },
  },
});
