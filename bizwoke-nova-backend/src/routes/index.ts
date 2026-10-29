import { Router } from 'express';
import { authenticate, requireTenant } from '../common/middleware/auth';
import { authRouter } from '../modules/auth/auth.routes';
import { tenantRouter } from '../modules/tenants/tenant.routes';
import { userRouter } from '../modules/users/user.routes';
import { membershipRouter } from '../modules/memberships/membership.routes';
import { roleRouter } from '../modules/roles/role.routes';
import { businessRouter } from '../modules/business-config/business.routes';
import { locationRouter } from '../modules/locations/location.routes';
import { serviceRouter } from '../modules/services/service.routes';
import { closureRouter, staffRouter } from '../modules/staff/staff.routes';
import { customerRouter } from '../modules/customers/customer.routes';
import { leadRouter } from '../modules/customers/lead.routes';
import { appointmentRouter } from '../modules/appointments/appointment.routes';
import { publicRouter } from '../modules/public/public.routes';
import { notificationRouter } from '../modules/notifications/notification.routes';
import { auditRouter } from '../modules/audit-logs/audit.routes';
import { subscriptionRouter, usageRouter } from '../modules/subscriptions/subscription.routes';
import { conversationRouter } from '../modules/conversations/conversation.routes';
import { knowledgeRouter } from '../modules/knowledge-base/knowledge.routes';
import { aiRouter } from '../modules/ai/ai.routes';
import { akNexusWebhookRouter, whatsappWebhookRouter } from '../modules/whatsapp/whatsapp.routes';
import { workflowRouter } from '../modules/workflows/workflow.routes';
import { exportRouter, importRouter } from '../modules/imports-exports/import-export.routes';

export function apiRouter(): Router {
  const api = Router();

  // Unauthenticated / self-authenticating route groups.
  api.use('/auth', authRouter());
  api.use('/public', publicRouter());
  api.use('/webhooks/whatsapp', whatsappWebhookRouter());
  api.use('/webhooks/aknexus', akNexusWebhookRouter());

  // Platform-level groups (authorization handled inside).
  api.use('/tenants', tenantRouter());
  api.use('/users', userRouter());
  api.use('/subscriptions', subscriptionRouter());

  // Tenant-scoped groups: tenant context comes ONLY from the verified session membership.
  const tenantScoped: [string, Router][] = [
    ['/business/closures', closureRouter()],
    ['/business', businessRouter()],
    ['/members', membershipRouter()],
    ['/roles', roleRouter()],
    ['/locations', locationRouter()],
    ['/services', serviceRouter()],
    ['/staff', staffRouter()],
    ['/customers', customerRouter()],
    ['/leads', leadRouter()],
    ['/appointments', appointmentRouter()],
    ['/notifications', notificationRouter()],
    ['/conversations', conversationRouter()],
    ['/knowledge-base', knowledgeRouter()],
    ['/ai', aiRouter()],
    ['/workflows', workflowRouter()],
    ['/imports', importRouter()],
    ['/exports', exportRouter()],
    ['/audit-logs', auditRouter()],
    ['/usage', usageRouter()],
  ];
  for (const [path, router] of tenantScoped) api.use(path, authenticate, requireTenant, router);

  return api;
}
