import { defineConfig } from "@tanstack/react-start/config";
import { SECURITY_HEADERS } from "./src/server/security-headers";

export default defineConfig({
  server: {
    // Inject security headers on every dynamically-rendered response.
    // Static assets are covered by public/_headers (Cloudflare-native).
    responseHeaders: () => {
      return SECURITY_HEADERS;
    },
  },
});
