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
        // Layered, blue-tinted lift for white work surfaces (subtle, not the
        // default flat grey).
        card: "0 1px 2px 0 rgb(23 72 216 / 0.05), 0 14px 30px -22px rgb(23 35 61 / 0.5)",
        panel:
          "0 1px 2px 0 rgb(23 72 216 / 0.04), 0 22px 48px -32px rgb(23 35 61 / 0.55)",
        // Stat cards: a 2px gloss rail along the top edge plus the soft lift.
        rail: "inset 0 2px 0 0 rgb(86 139 255 / 0.45), 0 1px 2px 0 rgb(23 72 216 / 0.05), 0 14px 30px -22px rgb(23 35 61 / 0.5)",
        // Elevated white surfaces (dialogs, dropdowns).
        lift: "0 1px 2px 0 rgb(23 72 216 / 0.06), 0 28px 60px -34px rgb(23 35 61 / 0.6)",
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
