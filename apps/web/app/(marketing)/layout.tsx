import { Manrope } from 'next/font/google';
import './landing.css';

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-manrope' });

/** Public marketing pages: always light, always Manrope, independent from the in-app theme. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${manrope.variable} lx min-h-screen bg-lx-paper font-manrope text-lx-ink`}>{children}</div>;
}
