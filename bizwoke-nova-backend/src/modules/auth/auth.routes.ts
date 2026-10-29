import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { Errors } from '../../common/errors/app-error';
import { authenticate } from '../../common/middleware/auth';
import { authLimiter } from '../../common/middleware/rate-limit';
import { validate, valid } from '../../common/middleware/validate';
import { email, objectId, password, phone, slug, timezone } from '../../common/validation/schemas';
import { ok, created } from '../../common/utils/http';
import * as auth from './auth.service';

const registerBody = z
  .object({
    email,
    password,
    name: z.string().trim().min(1).max(120),
    phone: phone.optional(),
    business: z
      .object({
        name: z.string().trim().min(2).max(120),
        slug,
        timezone: timezone.default('UTC'),
        locale: z.string().min(2).max(10).default('en'),
        category: z.string().trim().max(60).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const loginBody = z
  .object({ email, password: z.string().min(1).max(128), tenantSlug: slug.optional() })
  .strict();
const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
const logoutBody = z.object({ allSessions: z.boolean().default(false) }).strict();
const forgotBody = z.object({ email }).strict();
const resetBody = z.object({ token: z.string().min(20).max(200), newPassword: password }).strict();
const switchBody = z.object({ tenantId: objectId }).strict();

const client = (req: Request): auth.ClientInfo => ({
  ip: req.ip,
  userAgent: req.header('user-agent'),
  requestId: req.requestId,
});

export function authRouter(): Router {
  const r = Router();
  const limiter = authLimiter();

  r.post('/register', limiter, validate({ body: registerBody }), async (req, res) => {
    const body = valid<z.infer<typeof registerBody>>(res).body;
    if (body.business && !env().ALLOW_SELF_SIGNUP_TENANTS) {
      throw Errors.forbidden('Self-service business registration is disabled');
    }
    created(req, res, await auth.register(body, client(req)));
  });

  r.post('/login', limiter, validate({ body: loginBody }), async (req, res) => {
    ok(req, res, await auth.login(valid<z.infer<typeof loginBody>>(res).body, client(req)));
  });

  r.post('/refresh', limiter, validate({ body: refreshBody }), async (req, res) => {
    ok(req, res, await auth.refresh(valid<z.infer<typeof refreshBody>>(res).body.refreshToken, client(req)));
  });

  r.post('/logout', authenticate, validate({ body: logoutBody }), async (req, res) => {
    await auth.logout(
      req.auth!.sessionId,
      req.auth!.userId,
      valid<z.infer<typeof logoutBody>>(res).body.allSessions,
    );
    ok(req, res, { loggedOut: true });
  });

  r.post('/forgot-password', limiter, validate({ body: forgotBody }), async (req, res) => {
    await auth.forgotPassword(valid<z.infer<typeof forgotBody>>(res).body.email, client(req));
    ok(req, res, { message: 'If the account exists, password reset instructions have been sent.' }, {}, 202);
  });

  r.post('/reset-password', limiter, validate({ body: resetBody }), async (req, res) => {
    const b = valid<z.infer<typeof resetBody>>(res).body;
    await auth.resetPassword(b.token, b.newPassword, client(req));
    ok(req, res, { reset: true });
  });

  r.post('/switch-tenant', authenticate, validate({ body: switchBody }), async (req, res) => {
    const b = valid<z.infer<typeof switchBody>>(res).body;
    ok(req, res, await auth.switchTenant(req.auth!.userId, req.auth!.sessionId, b.tenantId, client(req)));
  });

  r.get('/me', authenticate, async (req, res) => {
    ok(req, res, await auth.me(req.auth!.userId));
  });

  return r;
}
