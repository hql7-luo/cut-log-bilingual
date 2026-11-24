import { createHash, randomBytes } from "node:crypto";

// Print a one-time connector secret and its separate SQL registration statement.
const [ownerId, label = "Muse"] = process.argv.slice(2);
if (!ownerId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ownerId) || label.length > 80) {
  console.error("Usage: node scripts/create-agent-token.mjs <Supabase user UUID> [connector name]");
  process.exit(1);
}
const token = "cut_" + randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const safe = label.replaceAll("'", "''");
console.log("Connector token (save in the connector's secure credential field):");
console.log(token);
console.log("\nRun only the following SQL in Supabase:");
console.log(`insert into cut_log_private.agent_keys(token_hash,user_id,label,expires_at)
values ('${hash}','${ownerId}','${safe}', now() + interval '180 days');`);
console.log("\nTo revoke the token:");
console.log(`update cut_log_private.agent_keys set revoked_at = now() where token_hash = '${hash}';`);
