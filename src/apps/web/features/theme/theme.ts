import { createStore } from "#web/platform/store/store.ts";
import { createStoredStore } from "#web/platform/store/stored-store.ts";
import { useStore } from "#web/platform/store/use-store.ts";

export const themePreferences = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof themePreferences)[number];
export type Theme = "light" | "dark";

const systemDarkQuery = "(prefers-color-scheme: dark)";
const preferenceStore = createStoredStore(
  "rebase:theme:v1",
  (saved): ThemePreference =>
    saved === "light" || saved === "dark" ? saved : "system",
);
const themeStore = createStore<Theme>("dark");

export const onThemeChange = themeStore.subscribe;

export function startTheme() {
  applyTheme();
  window.matchMedia(systemDarkQuery).addEventListener("change", applyTheme);
  preferenceStore.subscribe(applyTheme);
}

export function saveThemePreference(preference: ThemePreference) {
  preferenceStore.set(preference);
  applyTheme();
}

export function useThemePreference() {
  return useStore(preferenceStore);
}

export function useTheme() {
  return useStore(themeStore);
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
