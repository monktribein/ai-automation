/**
 * WhatsApp sender ids are either a phone number in digits ("919876543210") or, for contacts whose
 * number WhatsApp hides, a privacy id ("132491302195297@lid"). Privacy ids are NOT phone numbers:
 * replies must go to the exact id, so it is kept verbatim. Numbers are stored as "+<digits>".
 */
export const LID_PATTERN = /^\d{5,25}@lid$/;

export function contactAddress(senderId: string): string {
  return LID_PATTERN.test(senderId) ? senderId : `+${senderId.replace(/\D/g, '')}`;
}

export function isPrivacyId(address: string | undefined): boolean {
  return Boolean(address && LID_PATTERN.test(address));
}
