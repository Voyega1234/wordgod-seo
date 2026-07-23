import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedCorporateEmail } from '@/lib/auth/domain';

const PUBLIC_PATHS = new Set(['/login', '/unauthorized', '/auth/callback']);

function copyCookies(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach(cookie => target.cookies.set(cookie));
  return target;
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;
  const pathname = request.nextUrl.pathname;

  // API routes perform their own JSON authorization check after cookies refresh.
  if (pathname.startsWith('/api/') || PUBLIC_PATHS.has(pathname)) return response;

  if (!claims) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', pathname);
    return copyCookies(response, NextResponse.redirect(loginUrl));
  }

  if (!isAllowedCorporateEmail(claims.email)) {
    const deniedUrl = request.nextUrl.clone();
    deniedUrl.pathname = '/unauthorized';
    deniedUrl.search = '';
    return copyCookies(response, NextResponse.redirect(deniedUrl));
  }

  return response;
}
