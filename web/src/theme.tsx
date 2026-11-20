import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd';
import ruRU from 'antd/locale/ru_RU';

export type ThemeMode = 'light' | 'dark';

interface ThemeModeValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeModeContext = createContext<ThemeModeValue>({
  mode: 'dark',
  setMode: () => {},
});

export const useThemeMode = () => useContext(ThemeModeContext);

const STORAGE_KEY = 'crm-analyzer-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    document.body.dataset.theme = mode;
    document.body.style.colorScheme = mode;
  }, [mode]);

  const value = useMemo(() => ({ mode, setMode }), [mode]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ConfigProvider
        locale={ruRU}
        theme={{
          algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            borderRadius: 8,
            colorPrimary: '#1677ff',
            fontSize: 14,
          },
        }}
      >
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}

/** Палитра графиков: читается и в светлой, и в тёмной теме. */
export const CHART_PALETTE = [
  '#1677ff',
  '#722ed1',
  '#faad14',
  '#13c2c2',
  '#eb2f96',
  '#fa8c16',
  '#52c41a',
  '#2f54eb',
  '#a0d911',
  '#f5222d',
  '#08979c',
  '#d48806',
];

/** Цвета осей/сетки/тултипов Recharts из токенов Ant Design. */
export function useChartTheme() {
  const { token } = antdTheme.useToken();

  return useMemo(
    () => ({
      grid: token.colorBorderSecondary,
      axis: { fill: token.colorTextSecondary, fontSize: 11 },
      tooltip: {
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorder}`,
        borderRadius: 8,
        color: token.colorText,
        fontSize: 12,
      },
    }),
    [token],
  );
}
