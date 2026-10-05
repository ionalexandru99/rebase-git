import { createStore } from "#web/platform/store/store.ts";
import { useStore } from "#web/platform/store/use-store.ts";

export const themePreferences = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof themePreferences)[number];
export type Theme = "light" | "dark";

const preferenceKey = "rebase:theme:v1";
const systemDarkQuery = "(prefers-color-scheme: dark)";
const preferenceStore = createStore(readPreference());
const themeStore = createStore<Theme>("dark");

export const onThemeChange = themeStore.subscribe;

export function startTheme() {
  applyTheme();
  window.matchMedia(systemDarkQuery).addEventListener("change", applyTheme);
  window.addEventListener("storage", (event) => {
    if (event.key !== preferenceKey && event.key !== null) return;
    preferenceStore.set(readPreference());
    applyTheme();
  });
}

export function saveThemePreference(preference: ThemePreference) {
  preferenceStore.set(preference);
  try {
    localStorage.setItem(preferenceKey, preference);
  } catch {}
  applyTheme();
}

export function useThemePreference() {
  return useStore(preferenceStore);
}

export function useTheme() {
  return useStore(themeStore);
}

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(preferenceKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function applyTheme() {
  const preference = preferenceStore.getSnapshot();
  const theme =
    preference !== "system"
      ? preference
      : window.matchMedia(systemDarkQuery).matches
        ? "dark"
        : "light";
  document.documentElement.classList.toggle("dark", theme === "dark");
  themeStore.set(theme);
}
