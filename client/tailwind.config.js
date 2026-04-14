/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: 'var(--theme-accent-light)',
          100: 'color-mix(in srgb, var(--theme-accent-light) 80%, var(--theme-accent) 20%)',
          200: 'color-mix(in srgb, var(--theme-accent-light) 60%, var(--theme-accent) 40%)',
          300: 'color-mix(in srgb, var(--theme-accent) 60%, var(--theme-accent-light) 40%)',
          400: 'color-mix(in srgb, var(--theme-accent) 80%, var(--theme-accent-light) 20%)',
          500: 'var(--theme-accent)',
          600: 'var(--theme-accent)',
          700: 'var(--theme-accent-hover)',
          800: 'color-mix(in srgb, var(--theme-accent-hover) 80%, black 20%)',
          900: 'color-mix(in srgb, var(--theme-accent-hover) 60%, black 40%)',
          950: 'color-mix(in srgb, var(--theme-accent-hover) 40%, black 60%)',
        },
        bakery: {
          cream: '#fdf8f0',
          wheat: '#e8d5b7',
          crust: '#8b5e3c',
          chocolate: '#3d1e0e',
        },
      },
    },
  },
  plugins: [],
};
