import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AmplifyProvider } from '@/components/shared/AmplifyProvider';
import { PwaUpdatePrompt } from '@/components/shared/PwaUpdatePrompt';
import { LanguageProvider } from '@/lib/i18n';
import { Watermark } from '@/components/shared/Watermark';

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
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* Prevent flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('lux-theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();(function(){try{var l=localStorage.getItem('lux-lang');if(l)document.documentElement.setAttribute('lang',l);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <AmplifyProvider>
          <LanguageProvider>
            {children}
            <PwaUpdatePrompt />
            <Watermark />
          </LanguageProvider>
        </AmplifyProvider>
      </body>
    </html>
  );
}
