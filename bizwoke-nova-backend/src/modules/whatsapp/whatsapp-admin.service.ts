import type { Types } from 'mongoose';
import { env } from '../../config/env';
import { AppError, Errors } from '../../common/errors/app-error';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { getWhatsAppProvider, WhatsAppProviderError } from '../../infrastructure/messaging/whatsapp.provider';
import { TenantSettingsModel, type TenantSettingsDoc } from '../business-config/tenant-settings.model';
import { consumeQuota } from '../usage/usage.service';

async function tenantWhatsApp(tenantId: Types.ObjectId) {
  const s = await new TenantRepository<TenantSettingsDoc>(TenantSettingsModel, tenantId).findOne({});
  return { settings: s, integration: s?.integrations?.whatsapp };
}

function providerFailure(err: unknown): AppError {
  if (err instanceof WhatsAppProviderError) return Errors.provider(`WhatsApp provider: ${err.message}`);
  return err instanceof AppError ? err : Errors.provider('WhatsApp provider request failed');
}

/** Connection overview for the tenant's WhatsApp sender. Only reads from the provider. */
export async function getWhatsAppStatus(tenantId: Types.ObjectId) {
  const e = env();
  const provider = getWhatsAppProvider();
  const { integration } = await tenantWhatsApp(tenantId);
  const instanceId = integration?.phoneNumberId;
  let connection: string = 'unknown';
  let error: string | undefined;
  if (!provider) connection = 'provider_not_configured';
  else if (!instanceId) connection = 'instance_not_set';
  else if (provider.getInstanceStatus) {
    try {
      connection = (await provider.getInstanceStatus(instanceId)).status;
    } catch (err) {
      connection = 'error';
      error = providerFailure(err).message;
    }
  }
  return {
    provider: provider?.name ?? null,
    whatsappEnabled: e.WHATSAPP_ENABLED,
    dryRun: e.WHATSAPP_DRY_RUN,
    integrationEnabled: Boolean(integration?.enabled),
    instanceId: instanceId ?? null,
    displayNumber: integration?.displayNumber ?? null,
    connection,
    error,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Sends one fixed test message from the tenant's own sender. The text is not caller-controlled,
 * so this endpoint cannot be used to send arbitrary content.
 */
export async function sendWhatsAppTest(tenantId: Types.ObjectId, to: string) {
  const provider = getWhatsAppProvider();
  if (!provider) throw Errors.integrationUnavailable('WhatsApp');
  const { settings, integration } = await tenantWhatsApp(tenantId);
  if (!integration?.enabled || !integration.phoneNumberId) {
    throw Errors.validation('Enable the WhatsApp integration and save an instance ID first');
  }
  const digits = to.replace(/\D/g, '');
  if (env().WHATSAPP_DRY_RUN) return { sent: false, dryRun: true, to: digits };
  await consumeQuota(tenantId, 'whatsappMessages');
  const business = settings?.profile.displayName ?? 'Bizwoke Nova';
  try {
    const r = await provider.sendText({
      phoneNumberId: integration.phoneNumberId,
      to: digits,
      text: `${business}: test message from Bizwoke Nova. Your WhatsApp automation is connected.`,
    });
    return { sent: true, dryRun: false, to: digits, reference: r.providerMessageId };
  } catch (err) {
    throw providerFailure(err);
  }
}
