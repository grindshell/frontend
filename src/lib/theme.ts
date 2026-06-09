// DaisyUI theme management. The list MUST stay in sync with the
// `@plugin "daisyui" { themes: … }` block in src/App.css — only themes declared
// there are actually compiled into the bundle.

export const THEMES = [
  "dark",
  "light",
  "cupcake",
  "bumblebee",
  "emerald",
  "corporate",
  "synthwave",
  "retro",
  "cyberpunk",
  "valentine",
  "halloween",
  "garden",
  "forest",
  "aqua",
  "lofi",
  "pastel",
  "fantasy",
  "wireframe",
  "black",
  "luxury",
  "dracula",
  "cmyk",
  "autumn",
  "business",
  "acid",
  "lemonade",
  "night",
  "coffee",
  "winter",
  "dim",
  "nord",
  "sunset",
  "abyss",
  "silk",
  "caramellatte",
] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "dark";
const STORAGE_KEY = "grindshell.theme";

export function loadTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved && (THEMES as readonly string[]).includes(saved)
    ? (saved as Theme)
    : DEFAULT_THEME;
}

/** Apply a theme to <html data-theme> without persisting (used for live preview). */
export function applyTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Apply and persist a theme as the saved preference. */
export function setTheme(theme: Theme) {
  applyTheme(theme);
  localStorage.setItem(STORAGE_KEY, theme);
}
