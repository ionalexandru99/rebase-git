import type { KeyboardShortcutStorage } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";

export function browserKeyboardShortcutStorage(): KeyboardShortcutStorage {
  const backing = availableLocalStorage();
  return {
    getItem: (key) => attempt(() => backing?.getItem(key) ?? null, null),
    removeItem: (key) => attempt(() => backing?.removeItem(key), undefined),
    setItem: (key, value) =>
      attempt(() => backing?.setItem(key, value), undefined),
  };
}

function availableLocalStorage(): Storage | undefined {
  return attempt(
    () => (typeof localStorage === "undefined" ? undefined : localStorage),
    undefined,
  );
}

function attempt<T>(operation: () => T, fallback: T): T {
  try {
    return operation();
  } catch {
    return fallback;
  }
}
