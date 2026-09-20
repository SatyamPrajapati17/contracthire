import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        parchment: "var(--cl-parchment)",
        canvas: "var(--cl-surface)",
        surface: "var(--cl-surface)",
        sunk: "var(--cl-surface-sunken)",
        lake: "var(--cl-lake)",
        "lake-hover": "var(--cl-lake-hover)",
        "lake-active": "var(--cl-lake-active)",
        "lake-tint": "var(--cl-lake-tint)",
        periwinkle: "var(--cl-periwinkle)",
        "periwinkle-deep": "var(--cl-periwinkle-deep)",
        sky: "var(--cl-periwinkle-deep)",
        mint: "var(--cl-mint)",
        coral: "var(--cl-coral)",
        gold: "var(--cl-gold)",
        orange: "var(--cl-orange)",
        ink: "var(--cl-ink)",
        offblack: "var(--cl-offblack)",
        graphite: "var(--cl-graphite)",
        smoke: "var(--cl-smoke)",
        ash: "var(--cl-ash)",
        "ash-soft": "var(--cl-ash-soft)",
        critical: "var(--cl-critical)",
        "critical-bg": "var(--cl-critical-bg)",
        high: "var(--cl-high)",
        "high-bg": "var(--cl-high-bg)",
        medium: "var(--cl-medium)",
        "medium-bg": "var(--cl-medium-bg)",
        low: "var(--cl-low)",
        "low-bg": "var(--cl-low-bg)",
        success: "var(--cl-success)",
        "success-bg": "var(--cl-success-bg)",
        info: "var(--cl-info)",
        "info-bg": "var(--cl-info-bg)"
      },
      fontFamily: {
        serif: ['"Source Serif 4"', '"Iowan Old Style"', "Georgia", "serif"],
        mono: ['"JetBrains Mono"', '"SF Mono"', "ui-monospace", "Menlo", "monospace"]
      },
      borderRadius: {
        card: "40px",
        panel: "24px",
        input: "12px",
        pill: "100px"
      },
      maxWidth: {
        content: "1432px",
        prose: "680px"
      },
      boxShadow: {
        floating: "0 8px 32px rgba(36,36,36,0.10)"
      }
    }
  },
  plugins: []
};
export default config;
