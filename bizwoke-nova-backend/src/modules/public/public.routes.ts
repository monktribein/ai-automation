import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { Errors } from '../../common/errors/app-error';
import { publicLimiter } from '../../common/middleware/rate-limit';
import { validate, valid } from '../../common/middleware/validate';
import { email, isoDate, isoDateTime, objectId, phone, slug } from '../../common/validation/schemas';
import { ok, created } from '../../common/utils/http';
import { normalizeEmail, normalizePhone } from '../../common/utils/text';
import { TenantRepository } from '../../infrastructure/mongodb/tenant-repository';
import { resolvePublicTenant } from '../tenants/tenant.service';
import { systemContext } from '../memberships/membership-context';
import { getAvailableSlots, loadSettings } from '../availability/availability.service';
import { ServiceModel, type ServiceDoc } from '../services/service.model';
import { StaffModel, StaffServiceAssignmentModel, type StaffDoc } from '../staff/staff.models';
import { customerRepo } from '../customers/customer.service';
import { createLead } from '../customers/lead.service';
import { queueNotification } from '../notifications/notification.service';
import { audit, originFromRequest } from '../audit-logs/audit.service';
import * as appointments from '../appointments/appointment.service';
import { idempotencyKey } from '../appointments/appointment.routes';
import type { AppointmentDoc } from '../appointments/appointment.models';
import { signAppointmentToken, verifyAppointmentToken } from '../auth/token.service';

const slugParam = z.object({ slug });
const apptParam = z.object({ slug, appointmentId: objectId });

const bookingBody = z
  .object({
    serviceId: objectId,
    staffId: objectId.optional(),
    startAt: isoDateTime,
    customer: z
      .object({
        name: z.string().trim().min(1).max(120),
        email: email.optional(),
        phone: phone.optional(),
        consent: z
          .object({ email: z.boolean(), whatsapp: z.boolean(), marketing: z.boolean() })
          .partial()
          .strict()
          .optional(),
      })
      .strict()
      .refine((c) => c.email || c.phone, 'Email or phone is required'),
    customerNotes: z.string().max(500).optional(),
  })
  .strict();

const accessBody = z
  .object({
    reference: z.string().regex(/^BK-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
    email: email.optional(),
    phone: phone.optional(),
  })
  .strict()
  .refine((b) => b.email || b.phone, 'Email or phone is required');

const changeBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), reason: z.string().max(500).optional() }).strict(),
  z.object({ action: z.literal('reschedule'), startAt: isoDateTime, staffId: objectId.optional() }).strict(),
]);

const slotsQuery = z
  .object({ serviceId: objectId, from: isoDate, to: isoDate.optional(), staffId: objectId.optional() })
  .strict();
const enquiryBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: email.optional(),
    phone: phone.optional(),
    message: z.string().max(2000).optional(),
    interest: z.string().max(200).optional(),
  })
  .strict()
  .refine((b) => b.email || b.phone, 'Email or phone is required');

/** Server-side slug -> tenant resolution. Every downstream query is scoped to this tenant only. */
async function resolveTenant(req: Request, _res: Response, next: NextFunction) {
  const parsed = slugParam.safeParse({ slug: req.params.slug });
  if (!parsed.success) throw Errors.notFound('Business');
  const t = await resolvePublicTenant(parsed.data.slug);
  req.tenant = systemContext(t, 'public');
  next();
}

async function requirePublicBooking(req: Request) {
  const settings = await loadSettings(req.tenant!.tenantId);
  if (!settings.features.publicBooking) throw Errors.featureDisabled('publicBooking');
  return settings;
}

function publicAppointment(a: AppointmentDoc) {
  return {
    id: a._id,
    reference: a.reference,
    status: a.status,
    serviceId: a.serviceId,
    staffId: a.staffId,
    startAt: a.startAt,
    endAt: a.endAt,
    timezone: a.timezone,
  };
}

function appointmentToken(req: Request): string {
  const token = req.header('x-appointment-token');
  if (!token) throw Errors.unauthenticated('X-Appointment-Token header is required');
  return token;
}

export function publicRouter(): Router {
  const r = Router({ mergeParams: true });
  r.use(publicLimiter());
  r.use('/:slug', resolveTenant);

  r.get('/:slug', async (req, res) => {
    const s = await loadSettings(req.tenant!.tenantId);
    ok(req, res, {
      slug: req.tenant!.slug,
      profile: s.profile,
      branding: s.branding,
      timezone: s.timezone,
      locale: s.locale,
      currency: s.currency,
      operatingHours: s.operatingHours,
      booking: {
        enabled: s.features.publicBooking,
        allowGuestBooking: s.bookingPolicy.allowGuestBooking,
        minNoticeMinutes: s.bookingPolicy.minNoticeMinutes,
        maxAdvanceDays: s.bookingPolicy.maxAdvanceDays,
        cancellationCutoffMinutes: s.bookingPolicy.cancellationCutoffMinutes,
      },
    });
  });

  r.get('/:slug/services', async (req, res) => {
    const items = await new TenantRepository<ServiceDoc>(ServiceModel, req.tenant!.tenantId).find(
      { status: 'ACTIVE', publiclyBookable: true },
      {
        projection: { name: 1, description: 1, durationMinutes: 1, price: 1, currency: 1, category: 1 },
        sort: { name: 1 },
        limit: 200,
      },
    );
    ok(req, res, items);
  });

  r.get(
    '/:slug/staff',
    validate({ query: z.object({ serviceId: objectId.optional() }).strict() }),
    async (req, res) => {
      const { serviceId } = valid<{ serviceId?: string }>(res).query;
      const tenantId = req.tenant!.tenantId;
      const filter: Record<string, unknown> = { status: 'ACTIVE', publiclyVisible: true };
      if (serviceId) {
        const a = await new TenantRepository(StaffServiceAssignmentModel, tenantId).find({ serviceId });
        filter._id = { $in: a.map((x) => x.staffId) };
      }
      // Contact details of staff are never exposed publicly.
      const items = await new TenantRepository<StaffDoc>(StaffModel, tenantId).find(filter, {
        projection: { name: 1, title: 1, bio: 1 },
        sort: { name: 1 },
        limit: 200,
      });
      ok(req, res, items);
    },
  );

  r.get('/:slug/slots', validate({ query: slotsQuery }), async (req, res) => {
    await requirePublicBooking(req);
    ok(
      req,
      res,
      await getAvailableSlots(req.tenant!, {
        ...valid<z.infer<typeof slotsQuery>>(res).query,
        publicOnly: true,
      }),
    );
  });

  r.post('/:slug/appointments', validate({ body: bookingBody }), async (req, res) => {
    const settings = await requirePublicBooking(req);
    if (!settings.bookingPolicy.allowGuestBooking)
      throw Errors.forbidden('This business requires an account to book');
    const key = req.header('idempotency-key');
    if (key !== undefined && !idempotencyKey.safeParse(key).success)
      throw Errors.validation('Invalid Idempotency-Key header');
    const b = valid<z.infer<typeof bookingBody>>(res).body;
    const { appointment, replayed } = await appointments.createAppointment(
      req.tenant!,
      { ...b, customer: b.customer },
      { source: 'PUBLIC', idempotencyKey: key, enforcePolicy: true, publicOnly: true },
    );
    if (!replayed)
      await audit(originFromRequest(req), {
        action: 'appointment.public_create',
        resourceType: 'appointment',
        resourceId: appointment._id,
      });
    const body = {
      appointment: publicAppointment(appointment),
      manageToken: signAppointmentToken(req.tenant!.tenantId.toString(), appointment._id.toString()),
    };
    if (replayed) return ok(req, res, body, { idempotentReplay: true });
    created(req, res, body);
  });

  /**
   * Re-issues a manage token to the contact on file. The token is DELIVERED to the customer's
   * email/WhatsApp, never returned in the response, so knowing a reference is not enough.
   */
  r.post('/:slug/appointment-access', validate({ body: accessBody }), async (req, res) => {
    const b = valid<z.infer<typeof accessBody>>(res).body;
    const tenantId = req.tenant!.tenantId;
    const appt = await appointments.getAppointmentByReference(tenantId, b.reference).catch(() => null);
    if (appt) {
      const customer = await customerRepo(tenantId).findById(appt.customerId);
      const emailMatch = b.email && customer?.emailNormalized === normalizeEmail(b.email);
      const phoneMatch = b.phone && customer?.phoneNormalized === normalizePhone(b.phone);
      if (customer && (emailMatch || phoneMatch)) {
        const token = signAppointmentToken(tenantId.toString(), appt._id.toString());
        const channel = emailMatch ? 'EMAIL' : 'WHATSAPP';
        await queueNotification(tenantId, {
          channel,
          to: (emailMatch ? customer.email : customer.phone)!,
          templateKey: 'appointment_access',
          data: { reference: appt.reference, accessToken: token },
          appointmentId: appt._id,
          customerId: customer._id,
        });
      }
    }
    ok(
      req,
      res,
      { message: 'If the details match a booking, an access link has been sent to the contact on file.' },
      {},
      202,
    );
  });

  r.get('/:slug/appointments/:appointmentId', validate({ params: apptParam }), async (req, res) => {
    const { appointmentId } = valid<{ appointmentId: string }>(res).params;
    verifyAppointmentToken(appointmentToken(req), req.tenant!.tenantId.toString(), appointmentId);
    ok(req, res, publicAppointment(await appointments.getAppointment(req.tenant!.tenantId, appointmentId)));
  });

  r.patch(
    '/:slug/appointments/:appointmentId',
    validate({ params: apptParam, body: changeBody }),
    async (req, res) => {
      const { params, body } = valid<{ appointmentId: string } & z.infer<typeof changeBody>>(res);
      verifyAppointmentToken(appointmentToken(req), req.tenant!.tenantId.toString(), params.appointmentId);
      const a =
        body.action === 'cancel'
          ? await appointments.transition(req.tenant!, params.appointmentId, 'CANCELLED', {
              reason: body.reason,
              enforceCutoff: true,
            })
          : await appointments.reschedule(req.tenant!, params.appointmentId, body, { enforcePolicy: true });
      await audit(originFromRequest(req), {
        action: `appointment.public_${body.action}`,
        resourceType: 'appointment',
        resourceId: a._id,
      });
      ok(req, res, publicAppointment(a));
    },
  );

  r.post('/:slug/enquiries', validate({ body: enquiryBody }), async (req, res) => {
    const lead = await createLead(
      req.tenant!.tenantId,
      { ...valid<z.infer<typeof enquiryBody>>(res).body, sourceDetail: 'public_api' },
      'PUBLIC',
    );
    created(req, res, { received: true, id: lead._id });
  });

  return r;
}
