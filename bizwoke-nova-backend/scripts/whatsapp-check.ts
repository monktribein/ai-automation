/**
 * Checks the AK Nexus WhatsApp connection using the values in .env.
 *
 *   npm run whatsapp:check                          # read-only: token, account, instance status
 *   npm run whatsapp:check -- --send-to=919876543210 # ALSO sends one real test message
 *
 * The send option delivers a real WhatsApp message; only use a number you own.
 */
import { env } from '../src/config/env';
import { AkNexusWhatsAppProvider } from '../src/infrastructure/messaging/whatsapp.provider';

const out = (s: string) => process.stdout.write(`${s}\n`);

async function get(path: string) {
  const e = env();
  const res = await fetch(`${e.AK_NEXUS_API_BASE_URL.replace(/\/$/, '')}${path}`, {
    headers: { Authorization: `Bearer ${e.AK_NEXUS_API_TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function main() {
  const e = env();
  if (!e.AK_NEXUS_API_TOKEN) throw new Error('AK_NEXUS_API_TOKEN is not set in .env');
  out(
    `Provider: ${e.WHATSAPP_PROVIDER ?? '(not set)'} | enabled: ${e.WHATSAPP_ENABLED} | dry run: ${e.WHATSAPP_DRY_RUN}`,
  );

  const account = await get('/account/info');
  out(
    `Token/account: HTTP ${account.status} ${account.body.status === 'success' ? 'OK' : JSON.stringify(account.body)}`,
  );

  const instances = await get('/whatsapp/instances');
  const list =
    (instances.body.instances as { instance_id: string; phone?: string; name?: string; status?: string }[]) ??
    [];
  out(`Instances (${list.length}):`);
  for (const i of list) out(`  - ${i.instance_id}  ${i.phone ?? ''}  ${i.name ?? ''}  [${i.status ?? '?'}]`);

  const id = e.AK_NEXUS_INSTANCE_ID;
  if (!id) out('AK_NEXUS_INSTANCE_ID is not set: inbound webhooks without an instance id cannot be routed.');
  else {
    const st = await get(`/whatsapp/instance/status/${encodeURIComponent(id)}`);
    out(`Configured instance ${id}: ${String(st.body.status ?? JSON.stringify(st.body))}`);
  }

  const sendArg = process.argv.find((a) => a.startsWith('--send-to='));
  if (sendArg) {
    if (!id) throw new Error('Set AK_NEXUS_INSTANCE_ID before sending');
    const to = sendArg.split('=')[1]!;
    const r = await new AkNexusWhatsAppProvider(e.AK_NEXUS_API_TOKEN, e.AK_NEXUS_API_BASE_URL).sendText({
      phoneNumberId: id,
      to,
      text: 'Bizwoke Nova test message: your WhatsApp automation is connected.',
    });
    out(
      `Test message accepted by AK Nexus for ${to} (ref ${r.providerMessageId}). Check the phone to confirm delivery.`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`WhatsApp check failed: ${(err as Error).message}\n`);
  process.exit(1);
});
