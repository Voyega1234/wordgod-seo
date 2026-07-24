import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedCorporateEmail } from '@/lib/auth/domain';
import { createClient } from '@/lib/supabase/server';

function safeNextUrl(value: string | null, origin: string): URL {
  if (!value?.startsWith('/')) return new URL('/', origin);

  const target = new URL(value, origin);
  return target.origin === origin ? target : new URL('/', origin);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const nextUrl = safeNextUrl(requestUrl.searchParams.get('next'), requestUrl.origin);
  const supabase = await createClient();

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', requestUrl.origin));
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(new URL('/login?error=email_callback', requestUrl.origin));
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

  return NextResponse.redirect(nextUrl);
}
