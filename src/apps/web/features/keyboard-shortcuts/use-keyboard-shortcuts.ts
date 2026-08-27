import { useSyncExternalStore } from "react";
import { keyboardShortcutStore } from "#web/features/keyboard-shortcuts/keyboard-shortcut-store";

export function useKeyboardShortcuts() {
  const store = keyboardShortcutStore();
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return { ...snapshot, store };
}
