import type {
  KeyboardShortcutBinding,
  KeyboardShortcutBindings,
  KeyboardShortcutClient,
  KeyboardShortcutCommand,
  KeyboardShortcutCommandId,
  KeyboardShortcutInput,
  KeyboardShortcutModifier,
  KeyboardShortcutPlatform,
  RepositorySelectionPosition,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";
import { repositorySelectionPositions } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";

export const keyboardShortcutCommands = [
  {
    contexts: ["application"],
    defaultBinding: { key: ",", modifiers: ["Mod", "Shift"] },
    group: "Navigation",
    id: "repository.openSettings",
    label: "Open repository settings",
  },
  {
    contexts: ["application"],
    defaultBinding: { key: "o", modifiers: ["Mod", "Shift"] },
    group: "Navigation",
    id: "projects.showOpenProject",
    label: "Show Open Project",
  },
  {
    contexts: ["application"],
    defaultBinding: { key: "o", modifiers: ["Mod"] },
    group: "Navigation",
    id: "projects.browseRepository",
    label: "Browse for a repository",
  },
  {
    contexts: ["application", "repository-picker"],
    defaultBinding: { key: "w", modifiers: ["Mod"] },
    group: "Navigation",
    id: "projects.closeActiveRepository",
    label: "Close active repository",
  },
  {
    contexts: ["application"],
    defaultBinding: { key: "b", modifiers: ["Mod"] },
    group: "Navigation",
    id: "projects.toggleSidebar",
    label: "Toggle Projects sidebar",
  },
  {
    contexts: ["application"],
    defaultBinding: { key: "f", modifiers: ["Mod", "Shift"] },
    group: "Navigation",
    id: "projects.focusFilter",
    label: "Focus Projects filter",
  },
  {
    contexts: ["application"],
    defaultBinding: { key: "ArrowLeft", modifiers: ["Alt"] },
    group: "Navigation",
    id: "projects.selectPreviousRepository",
    label: "Select previous repository",
  },
  {
    contexts: ["application"],
    defaultBinding: { key: "ArrowRight", modifiers: ["Alt"] },
    group: "Navigation",
    id: "projects.selectNextRepository",
    label: "Select next repository",
  },
  ...repositorySelectionPositions.map(
    (position): KeyboardShortcutCommand => ({
      contexts: ["application"],
      defaultBinding: { key: String(position), modifiers: ["Alt"] },
      group: "Navigation",
      id: repositorySelectionCommandId(position),
      label:
        position === 9
          ? "Select last repository"
          : `Select repository ${position}`,
    }),
  ),
  {
    contexts: ["application"],
    defaultBinding: { key: "b", modifiers: ["Mod", "Shift"] },
    group: "Branches",
    id: "branches.focusSidebar",
    label: "Focus Branches sidebar",
  },
  {
    contexts: ["application"],
    defaultBinding: { key: ",", modifiers: ["Mod"] },
    group: "Navigation",
    id: "settings.open",
    label: "Open settings",
  },
  {
    contexts: ["application"],
    defaultBinding: { key: "g", modifiers: ["Mod", "Alt"] },
    group: "Commit graph",
    id: "graph.focus",
    label: "Focus commit graph",
  },
  {
    contexts: ["commit-graph"],
    defaultBinding: { key: "f", modifiers: ["Mod"] },
    group: "Commit graph",
    id: "graph.search",
    label: "Search commit history",
  },
  {
    contexts: ["commit-graph"],
    defaultBinding: { key: "F3", modifiers: ["Shift"] },
    group: "Commit graph",
    id: "graph.previousMatch",
    label: "Previous matching commit",
  },
  {
    contexts: ["commit-graph"],
    defaultBinding: { key: "F3", modifiers: [] },
    group: "Commit graph",
    id: "graph.nextMatch",
    label: "Next matching commit",
  },
  {
    contexts: ["commit-graph"],
    defaultBinding: { key: "ArrowUp", modifiers: ["Alt"] },
    group: "Commit graph",
    id: "graph.previousInLane",
    label: "Previous commit in this lane",
  },
  {
    contexts: ["commit-graph"],
    defaultBinding: { key: "ArrowDown", modifiers: ["Alt"] },
    group: "Commit graph",
    id: "graph.nextInLane",
    label: "Next commit in this lane",
  },
  {
    contexts: ["application"],
    defaultBinding: { key: "r", modifiers: ["Mod", "Alt"] },
    group: "Commit graph",
    id: "graph.fetch",
    label: "Fetch",
  },
  {
    contexts: ["application", "repository-picker"],
    defaultBinding: { key: "f", modifiers: ["Mod"] },
    group: "Search and lists",
    id: "search.focus",
    label: "Focus current search",
  },
  {
    contexts: ["repository-picker"],
    defaultBinding: { key: "Enter", modifiers: ["Mod"] },
    group: "Folder picker",
    id: "repositoryPicker.openSelectedRepository",
    label: "Open selected repository",
  },
] as const satisfies readonly KeyboardShortcutCommand[];

export const defaultKeyboardShortcutBindings = Object.fromEntries(
  keyboardShortcutCommands.map(({ defaultBinding, id }) => [
    id,
    defaultBinding,
  ]),
) as Readonly<Record<KeyboardShortcutCommandId, KeyboardShortcutBinding>>;

export function repositorySelectionCommandId(
  position: RepositorySelectionPosition,
) {
  return `projects.selectRepository${position}` as const;
}

export function keyboardShortcutFromInput(
  input: KeyboardShortcutInput,
  platform: KeyboardShortcutPlatform,
): KeyboardShortcutBinding | undefined {
  const key = normalizeKey(input.key);
  if (key === undefined || isModifierKey(key)) return undefined;

  const modifiers: KeyboardShortcutModifier[] = [];
  if (platform === "mac") {
    if (input.metaKey) modifiers.push("Mod");
    if (input.ctrlKey) modifiers.push("Control");
  } else {
    if (input.ctrlKey) modifiers.push("Mod");
    if (input.metaKey) modifiers.push("Meta");
  }
  if (input.altKey) modifiers.push("Alt");
  if (input.shiftKey) modifiers.push("Shift");
  return { key, modifiers };
}

export function keyboardShortcutValidationError(
  binding: KeyboardShortcutBinding,
): string | undefined {
  if (isModifierKey(binding.key)) {
    return "Use a non-modifier key.";
  }
  if (binding.key.length === 1 && binding.modifiers.length === 0) {
    return "Add a modifier to use a letter, number, or symbol.";
  }
  if (
    binding.modifiers.length === 0 &&
    [
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "Enter",
      "Escape",
      "Space",
      "Tab",
    ].includes(binding.key)
  ) {
    return "Add a modifier to use this key.";
  }
  return undefined;
}

export function matchesKeyboardShortcut(
  input: KeyboardShortcutInput,
  binding: KeyboardShortcutBinding | null,
  platform: KeyboardShortcutPlatform,
): boolean {
  if (binding === null) return false;
  const pressed = keyboardShortcutFromInput(input, platform);
  return (
    pressed !== undefined && keyboardShortcutBindingsEqual(pressed, binding)
  );
}

export function keyboardShortcutBindingsEqual(
  left: KeyboardShortcutBinding | null,
  right: KeyboardShortcutBinding | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.key === right.key &&
    left.modifiers.length === right.modifiers.length &&
    left.modifiers.every((modifier) => right.modifiers.includes(modifier))
  );
}

export function findKeyboardShortcutConflict(
  bindings: KeyboardShortcutBindings,
  commandId: KeyboardShortcutCommandId,
  binding: KeyboardShortcutBinding,
): KeyboardShortcutCommand | undefined {
  const commandDefinition = keyboardShortcutCommand(commandId);
  return keyboardShortcutCommands.find(
    (candidate) =>
      candidate.id !== commandId &&
      candidate.contexts.some((context) =>
        commandDefinition.contexts.includes(context),
      ) &&
      keyboardShortcutBindingsEqual(bindings[candidate.id], binding),
  );
}

export function keyboardShortcutCommand(
  commandId: KeyboardShortcutCommandId,
): KeyboardShortcutCommand {
  const definition = keyboardShortcutCommands.find(
    (candidate) => candidate.id === commandId,
  );
  if (definition === undefined) {
    throw new Error(`Unknown keyboard shortcut command: ${commandId}`);
  }
  return definition;
}

export function keyboardShortcutKeys(
  binding: KeyboardShortcutBinding | null,
  platform: KeyboardShortcutPlatform,
): readonly string[] {
  if (binding === null) return [];
  return [
    ...binding.modifiers.map((modifier) =>
      modifier === "Mod" ? (platform === "mac" ? "⌘" : "Ctrl") : modifier,
    ),
    displayKey(binding.key),
  ];
}

export function keyboardShortcutLabel(
  binding: KeyboardShortcutBinding | null,
  platform: KeyboardShortcutPlatform,
): string {
  return keyboardShortcutKeys(binding, platform).join(" ");
}

export function keyboardShortcutTitle(
  label: string,
  binding: KeyboardShortcutBinding | null,
  platform: KeyboardShortcutPlatform,
): string {
  const shortcut = keyboardShortcutLabel(binding, platform);
  return shortcut.length === 0 ? label : `${label} (${shortcut})`;
}

export function keyboardShortcutAria(
  binding: KeyboardShortcutBinding | null,
  platform: KeyboardShortcutPlatform,
): string | undefined {
  if (binding === null) return undefined;
  return [
    ...binding.modifiers.map((modifier) => {
      if (modifier !== "Mod") return modifier;
      return platform === "mac" ? "Meta" : "Control";
    }),
    binding.key,
  ].join("+");
}

export function keyboardShortcutWarning(
  binding: KeyboardShortcutBinding | null,
  client: KeyboardShortcutClient,
): string | undefined {
  if (binding === null) return undefined;
  const serialized = serializeBinding(binding);
  if (
    ["Mod+a", "Mod+c", "Mod+v", "Mod+x", "Mod+y", "Mod+z"].includes(serialized)
  ) {
    return "This shortcut is commonly used while editing text.";
  }
  if (client !== "browser") return undefined;
  if (["Mod+o", "Mod+w", "Mod+f", "Mod+,"].includes(serialized)) {
    return "Your browser may keep this shortcut for its own action.";
  }
  if (/^Alt\+(ArrowLeft|ArrowRight|[1-9])$/.test(serialized)) {
    return "Your browser may use this shortcut for navigation.";
  }
  return undefined;
}

export function isKeyboardShortcutBinding(
  value: unknown,
): value is KeyboardShortcutBinding {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<KeyboardShortcutBinding>;
  return (
    typeof candidate.key === "string" &&
    normalizeKey(candidate.key) === candidate.key &&
    Array.isArray(candidate.modifiers) &&
    candidate.modifiers.every(isKeyboardShortcutModifier) &&
    new Set(candidate.modifiers).size === candidate.modifiers.length &&
    keyboardShortcutValidationError(candidate as KeyboardShortcutBinding) ===
      undefined
  );
}

function normalizeKey(key: string): string | undefined {
  if (key.length === 0) return undefined;
  if (key === " ") return "Space";
  if (key === "Esc") return "Escape";
  return key.length === 1 ? key.toLocaleLowerCase() : key;
}

function displayKey(key: string): string {
  if (key === "ArrowLeft") return "←";
  if (key === "ArrowRight") return "→";
  if (key === "ArrowUp") return "↑";
  if (key === "ArrowDown") return "↓";
  return key.length === 1 ? key.toLocaleUpperCase() : key;
}

function isModifierKey(key: string): boolean {
  return ["Alt", "AltGraph", "Control", "Meta", "Mod", "Shift"].includes(key);
}

function isKeyboardShortcutModifier(
  value: unknown,
): value is KeyboardShortcutModifier {
  return ["Mod", "Control", "Meta", "Alt", "Shift"].includes(
    value as KeyboardShortcutModifier,
  );
}

function serializeBinding(binding: KeyboardShortcutBinding): string {
  return [...binding.modifiers, binding.key].join("+");
}
