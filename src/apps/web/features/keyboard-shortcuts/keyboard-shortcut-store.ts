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
  storage: KeyboardShortcutStorage,
): KeyboardShortcutStore {
  let overrides = readOverrides(storage);
  let snapshot = createSnapshot(overrides);
  const listeners = new Set<() => void>();

  const update = (nextOverrides: KeyboardShortcutOverrides) => {
    overrides = nextOverrides;
    snapshot = createSnapshot(overrides);
    if (Object.keys(overrides).length === 0) storage.removeItem(storageKey);
    else storage.setItem(storageKey, serializeOverrides(overrides));
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    resetAll: () => update({}),
    resetBinding: (commandId) => {
      if (!(commandId in overrides)) return;
      const { [commandId]: _, ...remaining } = overrides;
      update(withoutDisplacedCommand(remaining, commandId));
    },
    setBinding: (commandId, binding, replacedCommandId) => {
      const next = { ...overrides };
      if (replacedCommandId !== undefined) next[replacedCommandId] = null;
      if (
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

function withoutDisplacedCommand(
  overrides: KeyboardShortcutOverrides,
  restoredCommandId: KeyboardShortcutCommandId,
): KeyboardShortcutOverrides {
  const conflict = findKeyboardShortcutConflict(
    createSnapshot(overrides).bindings,
    restoredCommandId,
    defaultKeyboardShortcutBindings[restoredCommandId],
  );
  return conflict === undefined
    ? overrides
    : { ...overrides, [conflict.id]: null };
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

function serializeOverrides(overrides: KeyboardShortcutOverrides): string {
  return JSON.stringify({ bindings: overrides, version: 1 });
}

function readOverrides(
  storage: KeyboardShortcutStorage,
): KeyboardShortcutOverrides {
  const serialized = storage.getItem(storageKey);
  if (serialized === null) return {};
  const storedBindings = parseStoredBindings(serialized);
  return Object.fromEntries(
    keyboardShortcutCommandIds.flatMap((commandId) => {
      const binding = storedBindings[commandId];
      return binding === null || isKeyboardShortcutBinding(binding)
        ? [[commandId, binding]]
        : [];
    }),
  );
}

function parseStoredBindings(serialized: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const record = parsed as {
      readonly bindings?: unknown;
      readonly version?: unknown;
    };
    return record.version === 1 &&
      typeof record.bindings === "object" &&
      record.bindings !== null
      ? (record.bindings as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
