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
  sendTemplate(msg: WhatsAppTemplateMessage): Promise<{ providerMessageId: string }>;
  /** Free-form text: only valid inside the 24h customer-service window opened by an inbound message. */
  sendText(msg: WhatsAppTextMessage): Promise<{ providerMessageId: string }>;
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

let override: WhatsAppProvider | null | undefined;

export function getWhatsAppProvider(): WhatsAppProvider | null {
  if (override !== undefined) return override;
  const e = env();
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
