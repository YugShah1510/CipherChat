// These colors are copied from the desktop CSS so the mobile app feels like
// CipherChat even though its controls are laid out for touch screens.
export const palettes = {
  dark: {
    background: '#10131d',
    surface: '#151a27',
    input: '#1b2231',
    border: '#283143',
    text: '#eef1f8',
    muted: '#8993a8',
    accent: '#7c83ff',
    danger: '#f28b8b',
    notice: '#1b2231'
  },
  light: {
    background: '#f5f6fa',
    surface: '#ffffff',
    input: '#eef0f6',
    border: '#e2e5ee',
    text: '#202438',
    muted: '#7e8498',
    accent: '#6268e9',
    danger: '#b93e45',
    notice: '#eef0f6'
  }
} as const

export type ThemeColors = (typeof palettes)[keyof typeof palettes]
