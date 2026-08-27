import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";
import type { KeyboardShortcutRuntime } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";

const KeyboardShortcutsContext = createContext<
  KeyboardShortcutRuntime | undefined
>(undefined);

export function KeyboardShortcutsProvider({
  children,
  runtime,
}: {
  readonly children: ReactNode;
  readonly runtime: KeyboardShortcutRuntime;
}): JSX.Element {
  return (
    <KeyboardShortcutsContext.Provider value={runtime}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}

export function useKeyboardShortcuts() {
  const runtime = useContext(KeyboardShortcutsContext);
  if (runtime === undefined) {
    throw new Error(
      "useKeyboardShortcuts requires a KeyboardShortcutsProvider ancestor.",
    );
  }
  const { host, store } = runtime;
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return { ...snapshot, ...host, store };
}
