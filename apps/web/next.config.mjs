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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lirp.cdn-website.com' },
      { protocol: 'https', hostname: 'img.youtube.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
    ],
  },
  transpilePackages: ['@lux/types'],
};

export default withPWA(nextConfig);
