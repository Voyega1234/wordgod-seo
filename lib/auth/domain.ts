export const ALLOWED_EMAIL_DOMAIN = 'convertcake.com';

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.includes('@') ? email : null;
}

export function isAllowedCorporateEmail(value: unknown): value is string {
  const email = normalizeEmail(value);
  if (!email) return false;
  const separator = email.lastIndexOf('@');
  return separator > 0 && email.slice(separator + 1) === ALLOWED_EMAIL_DOMAIN;
}
