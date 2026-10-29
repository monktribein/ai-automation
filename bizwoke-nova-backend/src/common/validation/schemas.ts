import { Types } from 'mongoose';
import { z } from 'zod';
import { DateTime, IANAZone } from 'luxon';

export const objectId = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v) && /^[a-f0-9]{24}$/i.test(v), 'Invalid identifier');

export const idParam = (name = 'id') => z.object({ [name]: objectId });

export const timezone = z.string().refine((tz) => IANAZone.isValidZone(tz), 'Invalid IANA timezone');

export const isoDateTime = z
  .string()
  .refine((v) => DateTime.fromISO(v, { setZone: true }).isValid, 'Invalid ISO-8601 date-time')
  .transform((v) => DateTime.fromISO(v, { setZone: true }).toUTC().toJSDate());

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm (24h)');

export const email = z.string().trim().toLowerCase().email().max(254);
export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,20}$/, 'Invalid phone number');

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/, 'Slug must be 3-60 lowercase letters, digits or hyphens');

/** Arbitrary configurable metadata: flat, bounded, primitive values only, no `$`/`.` keys. */
export const metadata = z
  .record(
    z
      .string()
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid metadata key'),
    z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]),
  )
  .refine((m) => Object.keys(m).length <= 50, 'Too many metadata keys')
  .default({});

export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((p) => /[a-z]/i.test(p) && /\d/.test(p), 'Password must contain letters and digits');
