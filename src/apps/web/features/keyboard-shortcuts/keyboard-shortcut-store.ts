import {
  defaultKeyboardShortcutBindings,
  findKeyboardShortcutConflict,
  isKeyboardShortcutBinding,
  keyboardShortcutBindingsEqual,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type {
  KeyboardShortcutBinding,
  KeyboardShortcutCommandId,
  KeyboardShortcutSnapshot,
  KeyboardShortcutStorage,
  KeyboardShortcutStore,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";
import { keyboardShortcutCommandIds } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";

const storageKey = "rebase.keyboard-shortcuts.v1";

type KeyboardShortcutOverrides = Partial<
  Record<KeyboardShortcutCommandId, KeyboardShortcutBinding | null>
>;

export function createKeyboardShortcutStore(
  storage?: KeyboardShortcutStorage,
): KeyboardShortcutStore {
  let overrides = readOverrides(storage);
  let snapshot = createSnapshot(overrides);
  const listeners = new Set<() => void>();

  const update = (nextOverrides: KeyboardShortcutOverrides) => {
    overrides = nextOverrides;
    snapshot = createSnapshot(overrides);
    writeOverrides(storage, overrides);
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    resetAll: () => {
      overrides = {};
      snapshot = createSnapshot(overrides);
      removeOverrides(storage);
      for (const listener of listeners) listener();
    },
    resetBinding: (commandId) => {
      if (!(commandId in overrides)) return;
      const { [commandId]: _, ...remaining } = overrides;
      const defaultBinding = defaultKeyboardShortcutBindings[commandId];
      const conflict =
        defaultBinding === null
          ? undefined
          : findKeyboardShortcutConflict(
              createSnapshot(remaining).bindings,
              commandId,
              defaultBinding,
            );
      update(
        conflict === undefined
          ? remaining
          : { ...remaining, [conflict.id]: null },
      );
    },
    setBinding: (commandId, binding, replacedCommandId) => {
      const next = { ...overrides };
      if (replacedCommandId !== undefined) next[replacedCommandId] = null;
      if (
        binding !== null &&
        keyboardShortcutBindingsEqual(
          binding,
          defaultKeyboardShortcutBindings[commandId],
        )
      ) {
        delete next[commandId];
      } else {
        next[commandId] = binding;
      }
      update(next);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let clientStore: KeyboardShortcutStore | undefined;

export function keyboardShortcutStore(): KeyboardShortcutStore {
  clientStore ??= createKeyboardShortcutStore(clientStorage());
  return clientStore;
}

function createSnapshot(
  overrides: KeyboardShortcutOverrides,
): KeyboardShortcutSnapshot {
  return {
    bindings: { ...defaultKeyboardShortcutBindings, ...overrides },
    modifiedCommandIds: keyboardShortcutCommandIds.filter((commandId) =>
      Object.hasOwn(overrides, commandId),
    ),
  };
}

function readOverrides(
  storage: KeyboardShortcutStorage | undefined,
): KeyboardShortcutOverrides {
  try {
    const serialized = storage?.getItem(storageKey);
    if (serialized === undefined || serialized === null) return {};
    const parsed = JSON.parse(serialized) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const record = parsed as {
      readonly bindings?: unknown;
      readonly version?: unknown;
    };
    if (
      record.version !== 1 ||
      typeof record.bindings !== "object" ||
      record.bindings === null
    ) {
      return {};
    }

    const storedBindings = record.bindings as Record<string, unknown>;
    return Object.fromEntries(
      keyboardShortcutCommandIds.flatMap((commandId) => {
        const binding = storedBindings[commandId];
        return binding === null || isKeyboardShortcutBinding(binding)
          ? [[commandId, binding]]
          : [];
      }),
    );
  } catch {
    return {};
  }
}

function writeOverrides(
  storage: KeyboardShortcutStorage | undefined,
  overrides: KeyboardShortcutOverrides,
) {
  try {
    storage?.setItem(
      storageKey,
      JSON.stringify({ bindings: overrides, version: 1 }),
    );
  } catch {
    return;
  }
}

function removeOverrides(storage: KeyboardShortcutStorage | undefined) {
  try {
    storage?.removeItem(storageKey);
  } catch {
    return;
  }
}

function clientStorage(): KeyboardShortcutStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
