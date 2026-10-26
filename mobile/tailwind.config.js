/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        canvas: "#07111F",
        surface: "#0D1B2E",
        raised: "#13243B",
        line: "#1E334D",
        ink: "#E8F1FB",
        dim: "#8FA6C0",
        faint: "#5E7693",
        brand: "#3B82F6",
        cyan: "#22D3EE",
        ok: "#34D399",
        warn: "#FBBF24",
        danger: "#FB7185",
      },
      fontFamily: {
        sans: ["Inter_400Regular"],
        medium: ["Inter_500Medium"],
        semibold: ["Inter_600SemiBold"],
        bold: ["Inter_700Bold"],
        display: ["SpaceGrotesk_700Bold"],
        displayMedium: ["SpaceGrotesk_500Medium"],
      },
      borderRadius: {
        "4xl": "28px",
      },
    },
  },
  plugins: [],
};
