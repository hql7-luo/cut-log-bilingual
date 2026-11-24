import type { NextConfig } from "next";

const demo = process.env.STATIC_DEMO === "1";

// The static preview uses the same UI and leaves provider configuration blank.
const config: NextConfig = {
  ...(demo ? { output: "export" } : {
    async headers() {
      return [
        { source: "/:path*", headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=()" },
        ] },
        { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      ];
    },
  }),
  poweredByHeader: false,
};

export default config;
