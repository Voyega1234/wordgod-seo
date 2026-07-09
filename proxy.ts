import { NextRequest, NextResponse } from 'next/server';

const USERNAME = process.env.AUTH_USERNAME || 'wordgod';
const PASSWORD = process.env.AUTH_PASSWORD || '';

export function proxy(req: NextRequest) {
  // Skip auth if no password configured
  if (!PASSWORD) return NextResponse.next();

  const auth = req.headers.get('authorization');

  if (auth) {
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      const [user, pass] = decoded.split(':');
      if (user === USERNAME && pass === PASSWORD) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="WordGod"',
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
