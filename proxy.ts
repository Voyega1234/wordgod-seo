import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

const SUPABASE_ENABLED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL
  && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);

export default function proxy(req: NextRequest) {
  if (SUPABASE_ENABLED) return updateSession(req);
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();
  return new NextResponse('WordGod authentication is not configured', { status: 503 });
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|xlsx?|zip|webmanifest)).*)',
    '/(api)(.*)',
  ],
};
