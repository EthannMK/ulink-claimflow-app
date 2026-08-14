/** Theme from docs/DESIGN.md. Use tokens, not raw hex. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#1F4E79',
        'primary-dark': '#00375e',
        'primary-container': '#1f4e79',
        surface: '#f7f9fc',
        'surface-container': '#eceef1',
        'on-surface': '#191c1e',
        'on-surface-variant': '#42474f',
        outline: '#72777f',
        'outline-variant': '#c2c7d0',
        'text-main': '#485867',
        'brand-accent': '#ED5500',
        'status-ai': '#1F4E79',
        'status-approved': '#2D8A4E',
        'status-pending': '#D97706',
        'status-rejected': '#DC2626',
      },
      fontFamily: {
        display: ['"Hanken Grotesk"', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
