const path = require('path');
/** shadcn/ui zinc 主题 */
module.exports = {
  darkMode: ['class'],
  content: [path.join(__dirname, 'src/ui/**/*.{ts,tsx,html}')],
  safelist: ['text-2xs', 'text-xs', 'text-sm', 'text-md', 'text-lg', 'text-xl', 'text-2xl', 'rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-full'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', '"PingFang SC"', '"Microsoft YaHei UI"', '"Microsoft YaHei"', '"Noto Sans CJK SC"', '"Noto Sans SC"', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'] },
      // 字号阶梯（设计系统 §2）：只允许使用这些档位，禁止 text-[Npx]
      fontSize: { '2xs': ['11px', '16px'], xs: ['11.5px', '16px'], sm: ['13px', '20px'], base: ['13px', '20px'], md: ['14px', '22px'], lg: ['15px', '24px'], xl: ['18px', '26px'], '2xl': ['22px', '28px'] },
      transitionDuration: { DEFAULT: '150ms', fast: '150ms', base: '200ms' },
      colors: {
        border: 'hsl(var(--border))', input: 'hsl(var(--input))', ring: 'hsl(var(--ring))', background: 'hsl(var(--background))', foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        brand: { DEFAULT: 'hsl(var(--brand))', foreground: 'hsl(var(--brand-foreground))', soft: 'hsl(var(--brand-soft))' },
        sidebar: { DEFAULT: 'hsl(var(--sidebar))', foreground: 'hsl(var(--sidebar-foreground))', accent: 'hsl(var(--sidebar-accent))', 'accent-foreground': 'hsl(var(--sidebar-accent-foreground))', border: 'hsl(var(--sidebar-border))' },
        success: 'hsl(var(--success))', warning: 'hsl(var(--warning))',
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      keyframes: { 'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-collapsible-content-height)' } }, 'accordion-up': { from: { height: 'var(--radix-collapsible-content-height)' }, to: { height: '0' } } },
      animation: { 'accordion-down': 'accordion-down 0.15s ease-out', 'accordion-up': 'accordion-up 0.15s ease-out' },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
