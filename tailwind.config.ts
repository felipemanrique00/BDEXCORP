import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bbt: {
          primary: 'rgb(var(--bbt-primary-rgb) / <alpha-value>)',
          'primary-mid': 'rgb(var(--bbt-primary-mid-rgb) / <alpha-value>)',
          'primary-light': 'rgb(var(--bbt-primary-light-rgb) / <alpha-value>)',
          accent: 'rgb(var(--bbt-accent-rgb) / <alpha-value>)',
          violet: 'rgb(var(--bbt-violet-rgb) / <alpha-value>)',
          gold: 'rgb(var(--bbt-gold-rgb) / <alpha-value>)',
          'gray-50': 'rgb(var(--bbt-gray-50-rgb) / <alpha-value>)',
          'gray-100': 'rgb(var(--bbt-gray-100-rgb) / <alpha-value>)',
          text: 'rgb(var(--bbt-text-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateX(-20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
export default config
