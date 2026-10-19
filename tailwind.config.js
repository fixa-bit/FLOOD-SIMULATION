/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        flood: {
          surface: 'var(--flood-surface, #0f172a)',
          panel: 'var(--flood-panel, rgba(15, 23, 42, 0.85))',
          panelBorder: 'var(--flood-panel-border, rgba(51, 65, 85, 0.7))',
          primary: 'var(--flood-primary, #0ea5e9)',
          primaryHover: 'var(--flood-primary-hover, #0284c7)',
          accent: 'var(--flood-accent, #38bdf8)',
          water: 'var(--flood-water, #38bdf8)',
          danger: 'var(--flood-danger, #ef4444)',
          warning: 'var(--flood-warning, #f59e0b)',
          success: 'var(--flood-success, #10b981)',
          text: 'var(--flood-text, #f8fafc)',
          muted: 'var(--flood-muted, #94a3b8)',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      }
    },
  },
  plugins: [],
}
