"use client";

import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(() => navigator.serviceWorker.ready)
      .then((registration) => registration.active?.postMessage({
        type: "precache",
        urls: performance.getEntriesByType("resource").map(({ name }) => name).filter((url) => url.includes("/_next/static/")),
      })).catch(() => {});
  }, []);
  return null;
}
