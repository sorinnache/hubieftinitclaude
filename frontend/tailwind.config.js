/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#E91E63", 50: "#fdf2f8", 100: "#fce7f3", 600: "#d81b60", 700: "#be185d" },
        ink: "#0F172A",
        bf: { bg: "#0C0D10", surface: "#15171C", surface2: "#1B1E24", line: "#2A2D34", text: "#F7F7F2", muted: "#B9BDC7", yellow: "#FFD21A", green: "#41D6A0", ink: "#0C0D10" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
    },
  },
  plugins: [],
};
