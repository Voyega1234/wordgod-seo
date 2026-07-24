import 'server-only';

import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { ALLOWED_EMAIL_DOMAIN, isAllowedCorporateEmail, normalizeEmail } from '@/lib/auth/domain';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server';

async function getVerifiedClaims(): Promise<Record<string, unknown> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return data.claims as Record<string, unknown>;
}

export { ALLOWED_EMAIL_DOMAIN, isSupabaseConfigured };

export async function authorizeApiRequest(): Promise<NextResponse | null> {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'WordGod authentication is not configured' },
      { status: 503 }
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
