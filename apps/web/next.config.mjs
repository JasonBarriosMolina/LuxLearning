// @ts-check
import withPWAInit from '@ducanh2912/next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  aggressiveFrontEndNavCaching: false,
  // Custom worker handles push events and is appended to the Workbox-generated SW.
  // Must point to a plain JS file — next-pwa does not transpile TypeScript here.
  customWorkerSrc: 'worker',
  customWorkerEntry: 'worker/index.js',
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: /\/api\/courses/,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'courses-cache',
          expiration: { maxEntries: 50, maxAgeSeconds: 86400 },
        },
      },
      {
        urlPattern: /\/api\/lessons/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'lessons-cache',
          expiration: { maxEntries: 200, maxAgeSeconds: 604800 },
        },
      },
      {
        urlPattern: /youtube\.com\/embed/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'videos-cache',
          expiration: { maxEntries: 50, maxAgeSeconds: 2592000 },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'google-fonts-cache',
          expiration: { maxEntries: 20, maxAgeSeconds: 31536000 },
        },
      },
    ],
  },
});

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://www.youtube-nocookie.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https: http:",
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com",
      "connect-src 'self' https://*.amazonaws.com https://*.execute-api.us-east-1.amazonaws.com https://cognito-idp.us-east-1.amazonaws.com wss://*.execute-api.us-east-1.amazonaws.com https://fonts.googleapis.com https://fonts.gstatic.com",
      "media-src 'self' blob: https://lux-learning-images.s3.amazonaws.com",
      "worker-src 'self' blob:",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Skip type checking and lint in production build (handled locally / in CI)
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lirp.cdn-website.com' },
      { protocol: 'https', hostname: 'img.youtube.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'lux-learning-images.s3.amazonaws.com' },
    ],
  },
  transpilePackages: ['@lux/types'],
};

export default withPWA(nextConfig);
