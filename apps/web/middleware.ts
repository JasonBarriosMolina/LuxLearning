import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Auth is handled client-side via layout guards (useAuth hook).
// Amplify v6 stores tokens in localStorage (not cookies), so
// server-side session detection here is not possible without
// a custom cookie-based token storage adapter.
// The API layer is secured independently via Lambda Authorizer.
export function middleware(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|workbox).*)',
  ],
};
