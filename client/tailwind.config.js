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
      keyframes: {
        blob: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(3%, -4%) scale(1.08)" },
          "66%": { transform: "translate(-3%, 3%) scale(0.95)" },
        },
        twinkle: {
          "0%, 100%": { opacity: 0.25, transform: "scale(0.9)" },
          "50%": { opacity: 1, transform: "scale(1.1)" },
        },
      },
      animation: {
        blob: "blob 12s ease-in-out infinite",
        twinkle: "twinkle 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
