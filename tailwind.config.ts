import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        maher: {
          surface: "hsl(var(--maher-surface))",
          "surface-strong": "hsl(var(--maher-surface-strong))",
          border: "hsl(var(--maher-border))",
          navy: "hsl(var(--maher-navy))",
          "navy-light": "hsl(var(--maher-navy-light))",
          royal: "hsl(var(--maher-royal))",
          gloss: "hsl(var(--maher-gloss))",
          ink: "hsl(var(--maher-ink))",
          blue: "hsl(var(--maher-blue))",
          "blue-soft": "hsl(var(--maher-blue-soft))",
          money: "hsl(var(--maher-money))",
          warning: "hsl(var(--maher-warning))",
          done: "hsl(var(--maher-done))",
          due: "hsl(var(--maher-due))",
          "due-ink": "hsl(var(--maher-due-ink))",
        },
      },
      boxShadow: {
        // Neutral, tight lift for white work surfaces — no blue glow.
        card: "0 1px 2px 0 rgb(16 24 40 / 0.04), 0 12px 26px -22px rgb(16 24 40 / 0.35)",
        panel:
          "0 1px 2px 0 rgb(16 24 40 / 0.035), 0 20px 44px -32px rgb(16 24 40 / 0.4)",
        // Stat cards: a quiet navy hairline along the top edge plus the lift.
        rail: "inset 0 2px 0 0 rgb(34 61 87 / 0.18), 0 1px 2px 0 rgb(16 24 40 / 0.04), 0 12px 26px -22px rgb(16 24 40 / 0.35)",
        // Elevated white surfaces (dialogs, dropdowns).
        lift: "0 1px 2px 0 rgb(16 24 40 / 0.05), 0 24px 52px -30px rgb(16 24 40 / 0.45)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
