import { json, providerFlags } from "../../../server/providers.ts";

export const dynamic = "force-dynamic";

export function GET() { return json(providerFlags()); }
