import type { Config } from "tailwindcss"

const config = {
  darkMode: ["class"],
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  safelist: [
    // Status badge colors (bg-500 variants)
    'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-orange-500', 'bg-red-500',
    'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-cyan-500', 'bg-gray-500',
    'bg-emerald-500', 'bg-lime-500', 'bg-teal-500', 'bg-sky-500', 'bg-violet-500',
    'bg-fuchsia-500', 'bg-rose-500', 'bg-amber-500',
    // Background hazes (bg-50/50 variants) - 50% opacity for better differentiation
    'bg-blue-50/50', 'bg-green-50/50', 'bg-yellow-50/50', 'bg-orange-50/50', 'bg-red-50/50',
    'bg-purple-50/50', 'bg-pink-50/50', 'bg-indigo-50/50', 'bg-cyan-50/50', 'bg-gray-50/50',
    'bg-emerald-50/50', 'bg-lime-50/50', 'bg-teal-50/50', 'bg-sky-50/50', 'bg-violet-50/50',
    'bg-fuchsia-50/50', 'bg-rose-50/50', 'bg-amber-50/50',
    // Border colors (border-200 variants)
    'border-blue-200', 'border-green-200', 'border-yellow-200', 'border-orange-200', 'border-red-200',
    'border-purple-200', 'border-pink-200', 'border-indigo-200', 'border-cyan-200', 'border-gray-200',
    'border-emerald-200', 'border-lime-200', 'border-teal-200', 'border-sky-200', 'border-violet-200',
    'border-fuchsia-200', 'border-rose-200', 'border-amber-200',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
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
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config