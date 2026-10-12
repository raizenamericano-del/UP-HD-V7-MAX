/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Palet brand JernihHD "Ember" — amber → orange → rose di atas
        // charcoal hangat. Identitas baru, beda total dari Glacier (emerald/
        // cyan/blue) maupun Molten/violet sebelumnya.
        brand: {
          DEFAULT: '#fb923c',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          dark: '#9a3412',
        },
        // titik tengah gradien (rose) — key `iris` dipertahankan supaya
        // komponen lama tetap jalan tanpa diubah satu per satu.
        iris: { DEFAULT: '#fb7185', 400: '#fb7185', 500: '#f43f5f', 600: '#e11d48' },
        // aksen amber (sukses / highlight / QR)
        accent: { DEFAULT: '#fbbf24', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
        inks: {
          950: '#0e0a06',
          900: '#140d08',
          850: '#1a110a',
          800: '#221610',
          700: '#2e1d13',
          600: '#3d2717',
        },
        // alias (kompat komponen)
        ink: {
          950: '#0e0a06',
          900: '#140d08',
          850: '#1a110a',
          800: '#221610',
          700: '#2e1d13',
        },
        line: 'rgba(255,180,100,0.10)',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Plus Jakarta Sans Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 18px 50px -18px rgba(0,0,0,0.75)',
        glow: '0 0 50px -12px rgba(251,146,60,0.55)',
        'glow-iris': '0 0 50px -12px rgba(244,63,94,0.5)',
        'glow-accent': '0 0 50px -12px rgba(251,191,36,0.45)',
        inset: 'inset 0 1px 0 0 rgba(255,255,255,0.06)',
        glass: '0 8px 32px 0 rgba(0,0,0,0.45), inset 0 1px 0 0 rgba(255,255,255,0.08)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      backgroundImage: {
        'grad-brand': 'linear-gradient(100deg, #fbbf24 0%, #fb923c 48%, #f43f5f 100%)',
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.55' },
          '70%': { transform: 'scale(1.35)', opacity: '0' },
          '100%': { transform: 'scale(1.35)', opacity: '0' },
        },
        gradientX: { '0%,100%': { backgroundPosition: '0% 50%' }, '50%': { backgroundPosition: '100% 50%' } },
        scan: { '0%': { transform: 'translateY(-120%)' }, '100%': { transform: 'translateY(320%)' } },
        aurora: {
          '0%,100%': { transform: 'translate3d(0,0,0) scale(1)', opacity: '0.55' },
          '50%': { transform: 'translate3d(4%, -3%, 0) scale(1.15)', opacity: '0.85' },
        },
        morphpop: { '0%': { transform: 'scale(0.8)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        // Ember: ripple api + sheen kaca
        ripple: {
          '0%': { transform: 'scale(0.6)', opacity: '0.7' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        sheen: {
          '0%': { transform: 'translateX(-120%) skewX(-18deg)' },
          '100%': { transform: 'translateX(240%) skewX(-18deg)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2.2s linear infinite',
        floaty: 'floaty 5.5s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2.2s cubic-bezier(0.4,0,0.6,1) infinite',
        gradientX: 'gradientX 9s ease infinite',
        scan: 'scan 2.6s ease-in-out infinite',
        aurora: 'aurora 16s ease-in-out infinite',
        ripple: 'ripple 2.4s cubic-bezier(0.2,0.6,0.4,1) infinite',
        sheen: 'sheen 3.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
