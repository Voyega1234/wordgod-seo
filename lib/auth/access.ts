import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { redirect } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';
import { ALLOWED_EMAIL_DOMAIN, isAllowedCorporateEmail, normalizeEmail } from '@/lib/auth/domain';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server';

function safeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function hasValidBasicAuth(req: NextRequest): boolean {
  const expectedPassword = process.env.AUTH_PASSWORD || '';
  if (!expectedPassword) return process.env.NODE_ENV !== 'production';

  const expectedUsername = process.env.AUTH_USERNAME || 'wordgod';
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Basic ')) return false;

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    return safeEqual(decoded.slice(0, separator), expectedUsername)
      && safeEqual(decoded.slice(separator + 1), expectedPassword);
  } catch {
    return false;
  }
}

async function getVerifiedClaims(): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return data.claims as Record<string, unknown>;
}

export { ALLOWED_EMAIL_DOMAIN, isSupabaseConfigured };

export async function authorizeApiRequest(req: NextRequest): Promise<NextResponse | null> {
  if (!isSupabaseConfigured()) {
    if (hasValidBasicAuth(req)) return null;
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="WordGod"' } }
    );
  }

  const claims = await getVerifiedClaims();
  if (!claims) {
    return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  }
  if (!isAllowedCorporateEmail(claims.email)) {
    return NextResponse.json(
      { error: `อนุญาตเฉพาะบัญชี @${ALLOWED_EMAIL_DOMAIN} เท่านั้น` },
      { status: 403 }
    );
  }
  return null;
}

export async function requirePageAccess(): Promise<{ authEnabled: boolean; email?: string }> {
  if (!isSupabaseConfigured()) return { authEnabled: false };

  const claims = await getVerifiedClaims();
  if (!claims) redirect('/login');
  if (!isAllowedCorporateEmail(claims.email)) redirect('/unauthorized');
  return { authEnabled: true, email: normalizeEmail(claims.email) ?? undefined };
}
