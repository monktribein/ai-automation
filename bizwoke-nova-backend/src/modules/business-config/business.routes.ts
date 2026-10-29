import { Router } from 'express';
import { z } from 'zod';
import { Errors } from '../../common/errors/app-error';
import { requirePermission } from '../../common/middleware/auth';
import { validate, valid } from '../../common/middleware/validate';
import { hhmm, slug, timezone } from '../../common/validation/schemas';
import { ok } from '../../common/utils/http';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { isDuplicateKeyError } from '../../infrastructure/mongodb/transaction';
import { PERMISSIONS } from '../permissions/permissions';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import { TenantModel } from '../tenants/tenant.model';
import { updateTenant } from '../tenants/tenant.service';
import { effectiveLimits } from '../usage/usage.service';
import { TenantSettingsModel, type TenantSettingsDoc } from './tenant-settings.model';

const url = z
  .string()
  .url()
  .max(500)
  .refine((u) => /^https:\/\//.test(u), 'Only https URLs are allowed');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const hoursSchema = z
  .array(
    z
      .object({
        dayOfWeek: z.number().int().min(1).max(7),
        open: hhmm,
        close: z.union([hhmm, z.literal('24:00')]),
      })
      .strict(),
  )
  .max(21)
  .refine((h) => h.every((r) => r.open < r.close), 'open must be before close');

const patchBody = z
  .object({
    profile: z
      .object({
        displayName: z.string().trim().min(1).max(120),
        description: z.string().max(2000),
        category: z.string().max(60),
        email: z.string().email().max(254),
        phone: z.string().max(32),
        website: url,
        address: z.string().max(500),
      })
      .partial()
      .strict(),
    branding: z.object({ logoUrl: url, primaryColor: color, accentColor: color }).partial().strict(),
    timezone,
    locale: z.string().min(2).max(10),
    currency: z.string().length(3).toUpperCase(),
    operatingHours: hoursSchema,
    bookingPolicy: z
      .object({
        minNoticeMinutes: z.number().int().min(0).max(43_200),
        maxAdvanceDays: z.number().int().min(1).max(730),
        slotIntervalMinutes: z.union([
          z.literal(5),
          z.literal(10),
          z.literal(15),
          z.literal(20),
          z.literal(30),
          z.literal(60),
        ]),
        allowGuestBooking: z.boolean(),
        requireConfirmation: z.boolean(),
        cancellationCutoffMinutes: z.number().int().min(0).max(43_200),
        rescheduleCutoffMinutes: z.number().int().min(0).max(43_200),
      })
      .partial()
      .strict(),
    ai: z
      .object({
        enabled: z.boolean(),
        maxTurns: z.number().int().min(1).max(200),
        instructions: z.string().max(4000),
        model: z.string().max(100),
        handoffMessage: z.string().max(500),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

const slugBody = z.object({ slug }).strict();
const whatsappBody = z
  .object({
    phoneNumberId: z.string().regex(/^\d{5,30}$/),
    displayNumber: z.string().max(32).optional(),
    enabled: z.boolean(),
    templates: z
      .array(
        z
          .object({
            key: z.enum([
              'appointment_confirmation',
              'appointment_reminder',
              'appointment_cancelled',
              'appointment_rescheduled',
              'appointment_access',
              'handoff_ack',
            ]),
            name: z.string().regex(/^[a-z0-9_]{1,512}$/),
            language: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict();

/** Flattens nested partial objects into dotted $set paths so partial updates don't wipe siblings. */
function toDotted(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v))
      Object.assign(out, toDotted(v as Record<string, unknown>, path));
    else out[path] = v;
  }
  return out;
}

export function businessRouter(): Router {
  const r = Router();
  const repo = (req: Express.Request) =>
    new TenantRepository<TenantSettingsDoc>(TenantSettingsModel, req.tenant!.tenantId);

  r.get('/', requirePermission(PERMISSIONS.BUSINESS_READ), async (req, res) => {
    const [settings, tenant, limits] = await Promise.all([
      repo(req).findOne({}),
      TenantModel.findById(req.tenant!.tenantId, 'name slug status timezone locale').lean(),
      effectiveLimits(req.tenant!.tenantId),
    ]);
    if (!settings) throw Errors.notFound('Business settings');
    ok(req, res, { tenant, settings, limits });
  });

  r.patch(
    '/',
    requirePermission(PERMISSIONS.BUSINESS_MANAGE),
    validate({ body: patchBody }),
    async (req, res) => {
      const body = valid<z.infer<typeof patchBody>>(res).body;
      const { operatingHours, ...nested } = body;
      const set: Record<string, unknown> = toDotted(nested);
      if (operatingHours) set.operatingHours = operatingHours;
      if (body.ai && !req.tenant!.permissions.has(PERMISSIONS.AI_CONFIGURE))
        throw Errors.forbidden('ai:configure permission required');
      const updated = await repo(req).findOneAndUpdate({}, { $set: set });
      if (body.timezone)
        await TenantModel.updateOne({ _id: req.tenant!.tenantId }, { $set: { timezone: body.timezone } });
      await audit(originFromRequest(req), {
        action: 'business.update',
        resourceType: 'tenantSettings',
        resourceId: updated?._id,
        metadata: { fields: Object.keys(set) },
      });
      ok(req, res, updated);
    },
  );

  r.patch(
    '/slug',
    requirePermission(PERMISSIONS.BUSINESS_MANAGE),
    validate({ body: slugBody }),
    async (req, res) => {
      const { slug: newSlug } = valid<z.infer<typeof slugBody>>(res).body;
      const t = await updateTenant(req.tenant!.tenantId.toString(), { slug: newSlug });
      await audit(originFromRequest(req), {
        action: 'business.slug_change',
        resourceType: 'tenant',
        resourceId: t._id,
        metadata: { slug: newSlug },
      });
      ok(req, res, { slug: t.slug });
    },
  );

  r.put(
    '/integrations/whatsapp',
    requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE),
    validate({ body: whatsappBody }),
    async (req, res) => {
      const b = valid<z.infer<typeof whatsappBody>>(res).body;
      try {
        const updated = await repo(req).findOneAndUpdate(
          {},
          { $set: { 'integrations.whatsapp': b, 'features.whatsapp': b.enabled } },
        );
        await audit(originFromRequest(req), {
          action: 'integration.whatsapp_update',
          resourceType: 'tenantSettings',
          resourceId: updated?._id,
        });
        ok(req, res, updated?.integrations);
      } catch (err) {
        if (isDuplicateKeyError(err))
          throw Errors.conflict('This WhatsApp number is already connected to another business');
        throw err;
      }
    },
  );

  return r;
}
