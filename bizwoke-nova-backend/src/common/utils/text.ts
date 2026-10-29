/** Escape user text for safe use inside a RegExp (prevents ReDoS / regex injection in search). */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Keeps a leading + and digits only. Not a full E.164 validator, but gives a stable dedupe key. */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Neutralises spreadsheet formula injection (CSV/XLSX injection): values starting with
 * = + - @ tab or CR are prefixed with a single quote so spreadsheet apps treat them as text.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
