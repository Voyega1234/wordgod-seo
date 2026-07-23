import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

const USERNAME = process.env.AUTH_USERNAME || 'wordgod';
const PASSWORD = process.env.AUTH_PASSWORD || '';
const SUPABASE_ENABLED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL
  && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

function basicAuthProxy(req: NextRequest) {
  if (!PASSWORD) {
    if (process.env.NODE_ENV !== 'production') return NextResponse.next();
    return new NextResponse('WordGod authentication is not configured', { status: 503 });
  }

  const authorization = req.headers.get('authorization');
  if (authorization) {
    const [scheme, encoded] = authorization.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      const separator = decoded.indexOf(':');
      if (
        separator >= 0
        && decoded.slice(0, separator) === USERNAME
        && decoded.slice(separator + 1) === PASSWORD
      ) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="WordGod"' },
  });
}

export default function proxy(req: NextRequest) {
  return SUPABASE_ENABLED ? updateSession(req) : basicAuthProxy(req);
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|xlsx?|zip|webmanifest)).*)',
    '/(api)(.*)',
  ],
};
