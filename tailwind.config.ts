import type { Config } from "tailwindcss";
import containerQueries from "@tailwindcss/container-queries";
import animate from "tailwindcss-animate";

const rgb = (token: string) => `rgb(var(--color-${token}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    // 界面正文 13px 起，最小 12px；中文在 14px 以上才够清晰。
    fontSize: {
      xs: ["0.75rem", "1.5"],
      sm: ["0.8125rem", "1.55"],
      base: ["0.875rem", "1.6"],
      lg: ["1.125rem", "1.4"],
      xl: ["1.375rem", "1.3"],
      "2xl": ["1.75rem", "1.25"],
      "3xl": ["2rem", "1.2"],
    },
    extend: {
      colors: {
        bg: rgb("bg"),
        surface: { DEFAULT: rgb("surface"), 2: rgb("surface-2"), 3: rgb("surface-3") },
        line: { DEFAULT: rgb("line"), strong: rgb("line-strong") },
        ink: { DEFAULT: rgb("ink"), muted: rgb("ink-muted"), faint: rgb("ink-faint") },
        gold: { DEFAULT: rgb("gold"), bright: rgb("gold-bright"), press: rgb("gold-press") },
        "on-gold": rgb("on-gold"),
        ember: rgb("ember"),
        sage: rgb("sage"),
        rarity: {
          normal: rgb("rarity-normal"),
          magic: rgb("rarity-magic"),
          rare: rgb("rarity-rare"),
          unique: rgb("rarity-unique"),
        },
      },
      fontFamily: {
        display: ["Cinzel", "PingFang SC", "Microsoft YaHei UI", "Noto Sans SC", "serif"],
        sans: ["Inter", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Mono", "Consolas", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "10px",
        xl: "14px",
        "2xl": "18px",
      },
      boxShadow: {
        panel: "inset 0 1px 0 rgb(255 255 255 / 0.03), 0 1px 2px rgb(0 0 0 / 0.3)",
        raised: "inset 0 1px 0 rgb(255 255 255 / 0.04), 0 8px 20px rgb(0 0 0 / 0.28)",
        overlay: "inset 0 1px 0 rgb(255 255 255 / 0.05), 0 18px 48px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(0 0 0 / 0.35)",
        gold: "inset 0 1px 0 rgb(255 255 255 / 0.3), 0 2px 12px rgb(215 170 83 / 0.22)",
        "gold-ring": "0 0 0 1px rgb(215 170 83 / 0.55), 0 0 0 3px rgb(215 170 83 / 0.12)",
      },
      zIndex: {
        sticky: "10",
        dropdown: "30",
        overlay: "40",
        toast: "50",
        tooltip: "60",
      },
      transitionTimingFunction: { out: "cubic-bezier(0.22, 1, 0.36, 1)" },
      keyframes: {
        "beam-pulse": {
          "0%, 100%": { opacity: "0.85" },
          "50%": { opacity: "1" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "beam-pulse": "beam-pulse 3.2s ease-in-out infinite",
        "fade-in": "fade-in 150ms cubic-bezier(0.22, 1, 0.36, 1)",
        "slide-up": "slide-up 180ms cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [animate, containerQueries],
};

export default config;
