import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';
import { Errors } from '../../common/errors/app-error';
import type { PlatformRole } from '../../common/types/context';

interface AccessClaims {
  sub: string;
  sid: string;
  prl: PlatformRole;
  tid?: string;
  typ: 'access';
}

export function signAccessToken(c: Omit<AccessClaims, 'typ'>): string {
  return jwt.sign({ ...c, typ: 'access' }, env().JWT_ACCESS_SECRET, {
    expiresIn: env().JWT_ACCESS_TTL as SignOptions['expiresIn'],
    issuer: env().JWT_ISSUER,
    audience: 'api',
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const decoded = jwt.verify(token, env().JWT_ACCESS_SECRET, {
      issuer: env().JWT_ISSUER,
      audience: 'api',
      algorithms: ['HS256'],
    }) as AccessClaims;
    if (decoded.typ !== 'access' || !decoded.sub || !decoded.sid) throw new Error('bad claims');
    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw Errors.unauthenticated('Access token expired');
    throw Errors.unauthenticated('Invalid access token');
  }
}

/** Purpose-bound token authorising changes to ONE appointment in ONE tenant. */
interface AppointmentClaims {
  typ: 'appointment-manage';
  tid: string;
  aid: string;
}

export function signAppointmentToken(tenantId: string, appointmentId: string): string {
  return jwt.sign(
    { typ: 'appointment-manage', tid: tenantId, aid: appointmentId },
    env().APPOINTMENT_TOKEN_SECRET,
    {
      expiresIn: env().APPOINTMENT_TOKEN_TTL as SignOptions['expiresIn'],
      issuer: env().JWT_ISSUER,
      audience: 'appointment',
      algorithm: 'HS256',
    },
  );
}

export function verifyAppointmentToken(token: string, tenantId: string, appointmentId: string): void {
  let claims: AppointmentClaims;
  try {
    claims = jwt.verify(token, env().APPOINTMENT_TOKEN_SECRET, {
      issuer: env().JWT_ISSUER,
      audience: 'appointment',
      algorithms: ['HS256'],
    }) as AppointmentClaims;
  } catch {
    throw Errors.unauthenticated('Invalid or expired appointment access token');
  }
  if (claims.typ !== 'appointment-manage' || claims.tid !== tenantId || claims.aid !== appointmentId) {
    throw Errors.forbidden('Appointment access token does not grant access to this appointment');
  }
}

/** Parses ms-style durations ("15m", "7d", "3600s") into milliseconds. */
export function durationMs(value: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid duration: ${value}`);
  const n = Number(m[1]);
  const unit = m[2] ?? 's';
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return n * mult;
}
