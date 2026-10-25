import type { Config } from 'tailwindcss';

// Same blue family as the public landing (apps/web), gold only for small highlights.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1D3247',
        navy: '#0F2D4A',
        lux: '#17527E',
        royal: '#1F6FB2',
        bright: '#2F8FDB',
        cyan: '#1FA2C7',
        ice: '#EAF4FC',
        muted: '#4C6075',
        soft: '#7A8DA0',
        line: '#DCE6EF',
        canvas: '#F5F8FB',
        gold: '#E2BA50',
      },
      fontFamily: {
        sans: ['var(--font-manrope)', 'Manrope', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
