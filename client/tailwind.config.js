/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f2f6ff",
          100: "#e3ecff",
          200: "#c4d6ff",
          300: "#9bb6ff",
          400: "#6d8dff",
          500: "#4a66f5",
          600: "#3548d6",
          700: "#2b39ab",
          800: "#252f86",
          900: "#212a69",
        },
      },
    },
  },
  plugins: [],
};
