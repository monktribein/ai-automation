/**
 * Tolerant parser for AK Nexus outgoing webhooks ("new message" events).
 *
 * The AK Nexus docs do not publish the webhook body schema, so this accepts the common shapes:
 * flat objects ({ instance_id, from, message, id }), nested `data` / `message` objects, and
 * Baileys-style payloads ({ key: { remoteJid, fromMe, id }, message: { conversation } }).
 * Anything that yields no sender + text is reported as unparsed (stored, never processed).
 */
export interface AkNexusInbound {
  instanceId?: string;
  messageId?: string;
  from: string; // digits only, international format without "+"
  text: string;
  name?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return undefined;
}

function textOf(m: Obj): string | undefined {
  const msg = m.message;
  if (typeof msg === 'string') return msg;
  if (isObj(msg)) {
    // Interactive replies (list / button selections): the selected row/button id is the answer.
    const list = isObj(msg.listResponseMessage) ? msg.listResponseMessage : undefined;
    const single = list && isObj(list.singleSelectReply) ? list.singleSelectReply.selectedRowId : undefined;
    const btn = isObj(msg.buttonsResponseMessage) ? msg.buttonsResponseMessage.selectedButtonId : undefined;
    const tpl = isObj(msg.templateButtonReplyMessage) ? msg.templateButtonReplyMessage.selectedId : undefined;
    const interactive = firstString(single, btn, tpl);
    if (interactive) return interactive;
    const ext = isObj(msg.extendedTextMessage) ? msg.extendedTextMessage.text : undefined;
    const img = isObj(msg.imageMessage) ? msg.imageMessage.caption : undefined;
    const t = firstString(msg.conversation, ext, msg.text, msg.body, img);
    if (t) return t;
  }
  // Cloud-API style interactive replies: { interactive: { list_reply: { id } } } / { button: { payload } }
  const inter = isObj(m.interactive) ? m.interactive : undefined;
  const reply =
    inter &&
    (isObj(inter.list_reply) ? inter.list_reply : isObj(inter.button_reply) ? inter.button_reply : undefined);
  const flat = firstString(
    m.selectedRowId,
    m.selected_row_id,
    m.selectedButtonId,
    m.button_id,
    m.list_id,
    reply?.id,
    isObj(m.button) ? m.button.payload : undefined,
  );
  if (flat) return flat;
  const text = m.text;
  if (isObj(text)) return firstString(text.body);
  return firstString(text, m.body, m.content, m.msg);
}

function candidates(payload: Obj): Obj[] {
  const out: Obj[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(push);
    else if (isObj(v)) out.push(v);
  };
  const data = payload.data;
  if (isObj(data)) {
    push(data.messages);
    if (isObj(data.data)) push(data.data.messages);
    push(data);
  } else push(data);
  push(payload.messages);
  if (isObj(payload.message) && !('conversation' in payload.message)) push(payload.message);
  push(payload);
  return out;
}

export function parseAkNexusWebhook(payload: unknown): {
  instanceId?: string;
  event?: string;
  messages: AkNexusInbound[];
} {
  if (!isObj(payload)) return { messages: [] };
  const data = isObj(payload.data) ? payload.data : {};
  const instanceId = firstString(
    payload.instance_id,
    payload.instanceId,
    payload.instance,
    data.instance_id,
    data.instanceId,
  );
  const event = firstString(payload.event, payload.type, data.event);
  const messages: AkNexusInbound[] = [];
  const seen = new Set<string>();

  for (const m of candidates(payload)) {
    const key = isObj(m.key) ? m.key : {};
    const fromMe =
      m.fromMe === true ||
      m.from_me === true ||
      key.fromMe === true ||
      m.direction === 'outgoing' ||
      m.direction === 'out';
    if (fromMe) continue;
    const jid = firstString(key.remoteJid, m.remoteJid, m.chatId, m.chat_id);
    if (jid && /@(g\.us|broadcast|newsletter)$/.test(jid)) continue; // groups, status updates
    const rawFrom = firstString(m.from, m.phone, m.sender, m.number, m.wa_id, m.contact, jid);
    const [user, domain] = (rawFrom ?? '').split('@');
    const digits = user?.replace(/\D/g, '') ?? '';
    // Privacy ids ("...@lid") are not phone numbers: keep them verbatim so replies reach the sender.
    const from = domain === 'lid' ? `${digits}@lid` : digits;
    const text = textOf(m);
    if (digits.length < 8 || !text) continue;
    const messageId = firstString(m.id, m.message_id, m.messageId, key.id);
    const dedupe = messageId ?? `${from}:${text}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    messages.push({
      instanceId: firstString(m.instance_id, m.instanceId) ?? instanceId,
      messageId,
      from,
      text: text.slice(0, 4000),
      name: firstString(m.pushName, m.push_name, m.name, m.sender_name),
    });
  }
  return { instanceId, event, messages };
}
