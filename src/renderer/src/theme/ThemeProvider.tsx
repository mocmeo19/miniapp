import { ConfigProvider, theme as antdTheme } from 'antd'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type ThemeMode = 'light' | 'dark'
type ThemeContextValue = { mode: ThemeMode; setMode: (mode: ThemeMode) => void; toggleMode: () => void }

const ThemeContext = createContext<ThemeContextValue | null>(null)
const storageKey = 'miniapp-theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() =>
    localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light'
  )
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const preferences = window.desktop?.preferences
    if (!preferences) { setLoaded(true); return }
    let active = true
    void preferences.getTheme().then((saved) => {
      if (!active) return
      if (saved === 'light' || saved === 'dark') setMode(saved)
      setLoaded(true)
    }).catch(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = mode
    if (loaded) {
      if (window.desktop?.preferences) void window.desktop.preferences.setTheme(mode)
      localStorage.removeItem(storageKey)
    }
  }, [mode, loaded])

  const context = useMemo(
    () => ({ mode, setMode, toggleMode: () => setMode((value) => value === 'light' ? 'dark' : 'light') }),
    [mode]
  )

  return (
    <ThemeContext.Provider value={context}>
      <ConfigProvider
        theme={{
          algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: '#0b8043',
            colorInfo: '#2684fc',
            colorLink: mode === 'dark' ? '#34c46b' : '#0b8043',
            colorSuccess: '#00ac47',
            colorWarning: '#f0a344',
            colorError: '#e45b70',
            colorText: mode === 'dark' ? '#e8eaed' : '#202124',
            colorBgBase: mode === 'dark' ? '#17181a' : '#ffffff',
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            borderRadius: 10,
            controlHeight: 38
          },
          components: {
            Button: { primaryShadow: 'none', fontWeight: 600 },
            Card: { borderRadiusLG: 14 },
            Table: { headerBg: mode === 'dark' ? '#202124' : '#f8f9fa' }
          }
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
