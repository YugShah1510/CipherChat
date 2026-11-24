import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react'
import { palettes, type ThemeColors } from '../constants/colors'

type ThemeValue = {
  colors: ThemeColors
  isDark: boolean
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

/**
 * Keep one theme choice for the whole navigation tree. Desktop starts dark
 * and keeps its choice only for the current run, so mobile does the same.
 */
export function ThemeProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [isDark, setIsDark] = useState(true)
  const value = useMemo<ThemeValue>(
    () => ({
      colors: isDark ? palettes.dark : palettes.light,
      isDark,
      toggleTheme: () => setIsDark((previous) => !previous)
    }),
    [isDark]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Share the current palette with screens and reusable controls. */
export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
