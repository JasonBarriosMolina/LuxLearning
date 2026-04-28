import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AmplifyProvider } from '@/components/shared/AmplifyProvider';

export const metadata: Metadata = {
  title: { default: 'Lux Learning', template: '%s — Lux Learning' },
  description: 'Claridad que transforma. Plataforma educativa multi-curso.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Lux Learning',
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    siteName: 'Lux Learning',
    title: 'Lux Learning',
    description: 'Claridad que transforma.',
  },
};

export const viewport: Viewport = {
  themeColor: '#2C2C2C',
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body>
        <AmplifyProvider>
          {children}
        </AmplifyProvider>
      </body>
    </html>
  );
}
