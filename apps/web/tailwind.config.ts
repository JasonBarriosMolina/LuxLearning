import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        charcoal: 'var(--charcoal)',
        surface: 'var(--surface)',
        border: 'var(--border)',
        'cta-from': '#17527E',
        'cta-to': '#0F3F62',
        'lux-gold': '#E2BA50',
        'lux-gold-dark': '#C9A130',
        // Public landing palette (light, gold-forward)
        'lx-ink': '#1D3247',
        'lx-muted': '#4C6075',
        'lx-soft': '#7A8DA0',
        'lx-line': '#DCE6EF',
        'lx-sky': '#EEF5FB',
        'lx-dawn': '#FFF6DF',
        'lx-paper': '#FFFFFF',
        'lx-gold-deep': '#B07E17',
        // Blue family: institutional color in several tones
        'lx-navy': '#0F2D4A',
        'lx-royal': '#1F6FB2',
        'lx-bright': '#2F8FDB',
        'lx-cyan': '#1FA2C7',
        'lx-ice': '#EAF4FC',
      },
      fontFamily: {
        sans: ['Roboto', 'sans-serif'],
        heading: ['Montserrat', 'sans-serif'],
        manrope: ['var(--font-manrope)', 'Manrope', 'sans-serif'],
      },
      backgroundImage: {
        'cta-gradient': 'linear-gradient(135deg, #17527E, #0F3F62)',
        'cta-gradient-r': 'linear-gradient(315deg, #17527E, #0F3F62)',
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      boxShadow: {
        card: '0 2px 16px rgba(0, 0, 0, 0.08)',
        'card-hover': '0 8px 32px rgba(0, 0, 0, 0.12)',
        glow: '0 0 24px rgba(23, 82, 126, 0.25)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [typography],
};

export default config;
