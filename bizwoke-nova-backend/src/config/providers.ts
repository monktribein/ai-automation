import { env } from './env';
import { getAiProvider } from '../infrastructure/ai/ai.provider';
import { getWhatsAppProvider } from '../infrastructure/messaging/whatsapp.provider';
import { getEmailProvider } from '../infrastructure/email/email.provider';

/** Reports which optional integrations are configured. "available" never implies a live check passed. */
export function integrationStatus() {
  const e = env();
  return {
    ai: getAiProvider()
      ? { status: 'configured', provider: getAiProvider()!.name }
      : { status: 'unavailable' },
    whatsapp: getWhatsAppProvider()
      ? {
          status: 'configured',
          provider: getWhatsAppProvider()!.name,
          dryRun: e.WHATSAPP_DRY_RUN,
          ...(getWhatsAppProvider()!.name === 'aknexus'
            ? {
                inboundWebhook: Boolean(e.AK_NEXUS_WEBHOOK_SECRET),
                defaultInstance: Boolean(e.AK_NEXUS_INSTANCE_ID),
              }
            : {
                webhookVerification: Boolean(e.WHATSAPP_VERIFY_TOKEN),
                signatureValidation: Boolean(e.WHATSAPP_APP_SECRET),
              }),
        }
      : { status: 'unavailable' },
    email: getEmailProvider()
      ? { status: 'configured', provider: getEmailProvider()!.name }
      : { status: 'unavailable' },
    storage: { status: 'configured', provider: e.STORAGE_PROVIDER },
    queue: { status: e.REDIS_URL ? 'redis' : 'inline (non-durable)' },
  };
}
