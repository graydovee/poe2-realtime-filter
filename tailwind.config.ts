import type { Config } from "tailwindcss";

const rgb = (token: string) => `rgb(var(--color-${token}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: rgb("bg"),
        surface: { DEFAULT: rgb("surface"), 2: rgb("surface-2"), 3: rgb("surface-3") },
        line: { DEFAULT: rgb("line"), strong: rgb("line-strong") },
        ink: { DEFAULT: rgb("ink"), muted: rgb("ink-muted") },
        gold: { DEFAULT: rgb("gold"), bright: rgb("gold-bright"), press: rgb("gold-press") },
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
        display: ["Cinzel", "Songti SC", "SimSun", "serif"],
        sans: ["Inter", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Mono", "Consolas", "monospace"],
      },
      borderRadius: { sm: "4px", DEFAULT: "6px", lg: "10px" },
      boxShadow: {
        panel: "0 10px 26px rgba(0, 0, 0, 0.45)",
        hairline: "inset 0 1px 0 rgba(255, 255, 255, 0.04)",
        gold: "0 0 0 1px rgba(200, 164, 92, 0.35), 0 8px 24px rgba(0, 0, 0, 0.4)",
      },
      transitionTimingFunction: { out: "cubic-bezier(0.22, 1, 0.36, 1)" },
    },
  },
  corePlugins: { preflight: false },
  plugins: [],
};

export default config;
