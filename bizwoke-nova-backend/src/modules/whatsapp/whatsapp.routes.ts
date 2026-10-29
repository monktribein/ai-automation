import { Router } from 'express';
import { env } from '../../config/env';
import { Errors } from '../../common/errors/app-error';
import { safeEqual } from '../../common/utils/crypto';
import { verifyWhatsAppSignature } from '../../infrastructure/messaging/whatsapp.provider';
import { receiveWebhook } from './whatsapp.service';

export function whatsappWebhookRouter(): Router {
  const r = Router();

  // Meta webhook verification handshake.
  r.get('/', (req, res) => {
    const verifyToken = env().WHATSAPP_VERIFY_TOKEN;
    if (!verifyToken) throw Errors.integrationUnavailable('WhatsApp');
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (
      mode === 'subscribe' &&
      typeof token === 'string' &&
      safeEqual(token, verifyToken) &&
      typeof challenge === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(challenge)
    ) {
      res.type('text/plain').status(200).send(challenge);
      return;
    }
    throw Errors.forbidden('Webhook verification failed');
  });

  // Signed event delivery. Unsigned or badly signed requests are rejected before any processing.
  r.post('/', async (req, res) => {
    if (!env().WHATSAPP_APP_SECRET) throw Errors.integrationUnavailable('WhatsApp');
    if (!verifyWhatsAppSignature(req.rawBody, req.header('x-hub-signature-256')))
      throw Errors.unauthenticated('Invalid webhook signature');
    const { duplicate } = await receiveWebhook(req.rawBody!, req.body);
    res
      .status(200)
      .json({ success: true, data: { received: true, duplicate }, meta: {}, requestId: req.requestId });
  });

  return r;
}
