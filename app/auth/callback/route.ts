import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedCorporateEmail } from '@/lib/auth/domain';
import { createClient } from '@/lib/supabase/server';

function safeNextPath(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = safeNextPath(requestUrl.searchParams.get('next'));
  const supabase = await createClient();

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', requestUrl.origin));
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(new URL('/login?error=oauth_callback', requestUrl.origin));
  }

  const { data, error: claimsError } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;
  if (claimsError || !claims) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/login?error=invalid_session', requestUrl.origin));
  }

  if (!isAllowedCorporateEmail(claims.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/unauthorized', requestUrl.origin));
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
