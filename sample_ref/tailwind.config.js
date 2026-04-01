/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    'bg-cyan-400', 'bg-cyan-500/70', 'bg-amber-400', 'bg-amber-500/70',
    'text-cyan-400', 'text-amber-400',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

