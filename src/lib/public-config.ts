// Only the Supabase public project address and client key are embedded in the browser.
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
export const SUPABASE_KEY = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
export const CLOUD_ENABLED = /^https:\/\/[^\s/]+$/.test(SUPABASE_URL) && SUPABASE_KEY.length > 0;
