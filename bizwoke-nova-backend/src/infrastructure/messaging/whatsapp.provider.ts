import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { hmacSha256Hex, safeEqual } from '../../common/utils/crypto';

export interface WhatsAppTemplateMessage {
  phoneNumberId: string;
  to: string;
  template: { name: string; language: string; bodyParams: string[] };
}

export interface WhatsAppTextMessage {
  phoneNumberId: string;
  to: string;
  text: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  /**
   * true: business-initiated messages must use provider-approved templates (Meta Cloud API).
   * false: every notification is sent as rendered text (AK Nexus instances).
   */
  readonly requiresApprovedTemplates: boolean;
  sendTemplate(msg: WhatsAppTemplateMessage): Promise<{ providerMessageId: string }>;
  /** Free-form text: only valid inside the 24h customer-service window opened by an inbound message. */
  sendText(msg: WhatsAppTextMessage): Promise<{ providerMessageId: string }>;
  /** Live connection state of a sender (where the provider exposes it). */
  getInstanceStatus?(instanceId: string): Promise<{ status: string }>;
}

export class WhatsAppProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Official WhatsApp Business Platform (Meta Cloud API) adapter.
 * NOTE: implemented against the documented Graph API contract; not verified against a live
 * account in this repository's test suite (tests use a mock provider).
 */
export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta';
  readonly requiresApprovedTemplates = true;
  constructor(
    private readonly accessToken: string,
    private readonly graphUrl: string,
    private readonly apiVersion: string,
  ) {}

  private async post(phoneNumberId: string, body: Record<string, unknown>) {
    if (!/^\d+$/.test(phoneNumberId)) throw new WhatsAppProviderError('Invalid phone number id', false);
    const res = await fetch(`${this.graphUrl}/${this.apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new WhatsAppProviderError(
        json.error?.message ?? `WhatsApp API error ${res.status}`,
        res.status >= 500 || res.status === 429,
      );
    }
    const id = json.messages?.[0]?.id;
    if (!id) throw new WhatsAppProviderError('WhatsApp API returned no message id', true);
    return { providerMessageId: id };
  }

  sendTemplate(m: WhatsAppTemplateMessage) {
    return this.post(m.phoneNumberId, {
      to: m.to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: m.template.name,
        language: { code: m.template.language },
        components: m.template.bodyParams.length
          ? [
              {
                type: 'body',
                parameters: m.template.bodyParams.map((text) => ({
                  type: 'text',
                  text: text.slice(0, 1000),
                })),
              },
            ]
          : [],
      },
    });
  }

  sendText(m: WhatsAppTextMessage) {
    return this.post(m.phoneNumberId, {
      to: m.to.replace(/^\+/, ''),
      type: 'text',
      text: { body: m.text.slice(0, 4096) },
    });
  }
}

/**
 * AK Nexus API v2 adapter (https://app.aknexus.in/api/v2, Bearer token).
 * Contract from the AK Nexus API docs: POST /whatsapp/send/text { instance_id, to, message }
 * -> { status: "success", data: { sent: true } }. The sender is an AK Nexus WhatsApp instance id,
 * stored in the tenant's `integrations.whatsapp.phoneNumberId` field.
 */
export class AkNexusWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'aknexus';
  readonly requiresApprovedTemplates = false;
  constructor(
    private readonly token: string,
    private readonly baseUrl: string,
  ) {}

  async sendText(m: WhatsAppTextMessage) {
    if (!/^[A-Za-z0-9_-]{5,64}$/.test(m.phoneNumberId)) {
      throw new WhatsAppProviderError('Invalid AK Nexus instance id', false);
    }
    // WhatsApp privacy ids ("...@lid") must be sent verbatim; phone numbers are sent as digits.
    const to = /^\d{5,25}@lid$/.test(m.to) ? m.to : m.to.replace(/\D/g, '');
    if (to.replace(/\D/g, '').length < 8)
      throw new WhatsAppProviderError('Invalid recipient phone number', false);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/whatsapp/send/text`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance_id: m.phoneNumberId, to, message: m.text.slice(0, 4096) }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new WhatsAppProviderError(`AK Nexus unreachable: ${(err as Error).message}`, true);
    }
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      message?: string;
      messages?: { error?: string };
      data?: {
        sent?: boolean;
        id?: string;
        message_id?: string;
        key?: { id?: string };
        // Observed live: { data: { status, message, data: { key: { remoteJid, id } } } }
        data?: { key?: { id?: string } };
      };
    };
    if (!res.ok || json.status !== 'success' || json.data?.sent === false) {
      const reason = json.message ?? json.messages?.error ?? `AK Nexus API error ${res.status}`;
      throw new WhatsAppProviderError(reason, res.status === 429 || res.status >= 500);
    }
    // Use the WhatsApp message id when present, else record a local reference.
    const id = json.data?.id ?? json.data?.message_id ?? json.data?.key?.id ?? json.data?.data?.key?.id;
    return { providerMessageId: id ?? `aknexus-${randomUUID()}` };
  }

  async sendTemplate(): Promise<{ providerMessageId: string }> {
    throw new WhatsAppProviderError('AK Nexus adapter sends rendered text, not Meta templates', false);
  }

  /** GET /whatsapp/instance/status/{id} -> { status: "connected" | "disconnected" | ... }. Read-only. */
  async getInstanceStatus(instanceId: string): Promise<{ status: string }> {
    if (!/^[A-Za-z0-9_-]{5,64}$/.test(instanceId)) return { status: 'invalid_instance_id' };
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl.replace(/\/$/, '')}/whatsapp/instance/status/${encodeURIComponent(instanceId)}`,
        { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(15_000) },
      );
    } catch (err) {
      throw new WhatsAppProviderError(`AK Nexus unreachable: ${(err as Error).message}`, true);
    }
    const json = (await res.json().catch(() => ({}))) as { status?: string; messages?: { error?: string } };
    if (res.status === 401)
      throw new WhatsAppProviderError(json.messages?.error ?? 'AK Nexus token rejected', false);
    if (!res.ok) throw new WhatsAppProviderError(`AK Nexus API error ${res.status}`, res.status >= 500);
    return { status: typeof json.status === 'string' ? json.status : 'unknown' };
  }
}

let override: WhatsAppProvider | null | undefined;

export function getWhatsAppProvider(): WhatsAppProvider | null {
  if (override !== undefined) return override;
  const e = env();
  if (!e.WHATSAPP_ENABLED) return null;
  if (e.WHATSAPP_PROVIDER === 'aknexus' && e.AK_NEXUS_API_TOKEN) {
    return new AkNexusWhatsAppProvider(e.AK_NEXUS_API_TOKEN, e.AK_NEXUS_API_BASE_URL);
  }
  if (e.WHATSAPP_PROVIDER === 'meta' && e.WHATSAPP_ACCESS_TOKEN) {
    return new MetaCloudWhatsAppProvider(
      e.WHATSAPP_ACCESS_TOKEN,
      e.WHATSAPP_GRAPH_URL,
      e.WHATSAPP_API_VERSION,
    );
  }
  return null;
}

export function setWhatsAppProviderForTests(p: WhatsAppProvider | null | undefined) {
  override = p;
}

/** Validates Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the app secret). */
export function verifyWhatsAppSignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
  const secret = env().WHATSAPP_APP_SECRET;
  if (!secret || !rawBody || !header?.startsWith('sha256=')) return false;
  return safeEqual(header.slice(7), hmacSha256Hex(secret, rawBody));
}
