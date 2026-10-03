/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
    "./hooks/**/*.{js,jsx}",
    "./lib/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        "surface-3": "rgb(var(--surface-3) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-dim": "rgb(var(--ink-dim) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-strong": "rgb(var(--accent-strong) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",

        // --- GPS Work Force Monitor ---
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        brand: "rgb(var(--brand) / <alpha-value>)",
        "brand-strong": "rgb(var(--brand-strong) / <alpha-value>)",
        "brand-deep": "rgb(var(--brand-deep) / <alpha-value>)",
        "brand-tint": "rgb(var(--brand-tint) / <alpha-value>)",
        "brand-tint-2": "rgb(var(--brand-tint-2) / <alpha-value>)",
        crit: "rgb(var(--crit) / <alpha-value>)",
        "crit-tint": "rgb(var(--crit-tint) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        "ok-tint": "rgb(var(--ok-tint) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        "warn-tint": "rgb(var(--warn-tint) / <alpha-value>)",
        high: "rgb(var(--high) / <alpha-value>)",
        "high-tint": "rgb(var(--high-tint) / <alpha-value>)",
        med: "rgb(var(--med) / <alpha-value>)",
        "med-tint": "rgb(var(--med-tint) / <alpha-value>)",
        navy: "rgb(var(--navy) / <alpha-value>)",
        "navy-2": "rgb(var(--navy-2) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        card: "16px",
        field: "10px",
        pill: "9999px",
        modal: "16px",
        tile: "10px",
      },
      boxShadow: {
        card: "0 1px 0 0 rgb(var(--line) / 0.6) inset, 0 16px 40px -20px rgb(0 0 0 / 0.55)",
        pop: "0 24px 64px -16px rgb(0 0 0 / 0.65)",
        mon: "var(--card-shadow)",
      },
      fontSize: {
        // 10-11px uppercase letter-spaced section labels used across the module
        label: ["10px", { lineHeight: "14px", letterSpacing: "0.08em" }],
      },
      keyframes: {
        pulseRing: {
          "0%": { transform: "scale(0.6)", opacity: "0.8" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        pulseRing: "pulseRing 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
