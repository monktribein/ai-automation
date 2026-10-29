/**
 * Prints the AK Nexus webhook URL to paste into AK Nexus -> API & Automation -> Webhooks.
 *   npm run webhook:url -- https://something.trycloudflare.com
 * The secret comes from .env (AK_NEXUS_WEBHOOK_SECRET) and is only printed locally.
 */
import { env } from '../src/config/env';

const base = process.argv.slice(2).find((a) => /^https:\/\//.test(a));
if (!base) {
  process.stderr.write('Usage: npm run webhook:url -- https://<your-public-backend-url>\n');
  process.exit(1);
}
const e = env();
if (!e.AK_NEXUS_WEBHOOK_SECRET) {
  process.stderr.write('AK_NEXUS_WEBHOOK_SECRET is not set in .env\n');
  process.exit(1);
}
process.stdout.write(`\nPaste this into AK Nexus -> Webhooks -> Create Webhook:\n\n${base.replace(/\/+$/, '')}${e.API_PREFIX}/webhooks/aknexus/${e.AK_NEXUS_WEBHOOK_SECRET}\n\n`);
