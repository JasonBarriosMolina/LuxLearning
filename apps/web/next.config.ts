import type { NextConfig } from 'next';
// @ts-ignore — next-pwa types are loose
import withPWA from 'next-pwa';

const nextConfig: NextConfig = {
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

const withPWAConfig = withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
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
});

export default withPWAConfig(nextConfig);
