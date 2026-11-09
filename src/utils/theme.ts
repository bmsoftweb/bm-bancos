export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'bmbancos_theme';

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';

  try {
    const savedTheme = localStorage.getItem(STORAGE_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }

    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch (err) {
    console.warn('Erro ao ler preferência de tema:', err);
  }

  return 'light';
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }

  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (err) {
    console.warn('Erro ao salvar preferência de tema:', err);
  }
}
