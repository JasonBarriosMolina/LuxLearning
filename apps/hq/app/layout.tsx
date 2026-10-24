import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-manrope' });

export const metadata: Metadata = {
  title: { default: 'Lux HQ', template: '%s · Lux HQ' },
  description: 'Consola interna del equipo de Lux Learning.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={manrope.variable}>
      <body className="min-h-screen font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
