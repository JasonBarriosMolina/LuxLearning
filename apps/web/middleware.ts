import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/icons') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname.match(/\.(ico|png|svg|jpg|jpeg|webp|woff2?)$/)
  ) {
    return NextResponse.next();
  }

  // NOTE: Cognito JWT verification in middleware requires edge-compatible crypto.
  // For Next.js 14 with Cognito, we rely on client-side auth guards + the
  // Lambda Authorizer at the API layer for security.
  // The middleware here is a lightweight redirect for UX.
  //
  // In production, consider using NextAuth.js with Cognito provider for
  // full server-side session management.

  // Check for Cognito session cookie (set by Amplify)
  const hasCognitoSession = Array.from(request.cookies.getAll()).some(
    (c) => c.name.includes('CognitoIdentityServiceProvider') || c.name.includes('amplify')
  );

  if (!hasCognitoSession && !PUBLIC_PATHS.includes(pathname)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|workbox).*)',
  ],
};
