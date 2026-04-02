/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fdf8f0',
          100: '#f9edda',
          200: '#f3d9b4',
          300: '#ebbf84',
          400: '#e2a052',
          500: '#d98a35',
          600: '#c47228',
          700: '#a35923',
          800: '#854823',
          900: '#6d3c1f',
          950: '#3b1e0e',
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
