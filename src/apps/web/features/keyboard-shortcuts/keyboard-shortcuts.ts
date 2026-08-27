import type {
  KeyboardShortcutBinding,
  KeyboardShortcutBindings,
  KeyboardShortcutCommand,
  KeyboardShortcutCommandId,
  KeyboardShortcutInput,
  KeyboardShortcutModifier,
  KeyboardShortcutPlatform,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";

export const keyboardShortcutCommands = [
  command(
    "projects.showOpenProject",
    "Show Open Project",
    "Navigation",
    ["application"],
    "o",
    ["Mod", "Shift"],
  ),
  command(
    "projects.browseRepository",
    "Browse for a repository",
    "Navigation",
    ["application"],
    "o",
    ["Mod"],
  ),
  command(
    "projects.closeActiveRepository",
    "Close active repository",
    "Navigation",
    ["application", "repository-picker"],
    "w",
    ["Mod"],
  ),
  command(
    "projects.toggleSidebar",
    "Toggle Projects sidebar",
    "Navigation",
    ["application"],
    "b",
    ["Mod"],
  ),
  command(
    "projects.focusFilter",
    "Focus Projects filter",
    "Navigation",
    ["application"],
    "f",
    ["Mod", "Shift"],
  ),
  command(
    "projects.selectPreviousRepository",
    "Select previous repository",
    "Navigation",
    ["application"],
    "ArrowLeft",
    ["Alt"],
  ),
  command(
    "projects.selectNextRepository",
    "Select next repository",
    "Navigation",
    ["application"],
    "ArrowRight",
    ["Alt"],
  ),
  ...repositorySelectionCommands(),
  command(
    "settings.open",
    "Open settings",
    "Navigation",
    ["application"],
    ",",
    ["Mod"],
  ),
  command(
    "search.focus",
    "Focus current search",
    "Search and lists",
    ["application", "repository-picker"],
    "f",
    ["Mod"],
  ),
  command(
    "repositoryPicker.openSelectedRepository",
    "Open selected repository",
    "Folder picker",
    ["repository-picker"],
    "Enter",
    ["Mod"],
  ),
] as const satisfies readonly KeyboardShortcutCommand[];

export const defaultKeyboardShortcutBindings = Object.fromEntries(
  keyboardShortcutCommands.map(({ defaultBinding, id }) => [
    id,
    defaultBinding,
  ]),
) as KeyboardShortcutBindings;

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
    left.modifiers.every(
      (modifier, index) => modifier === right.modifiers[index],
    )
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

export function keyboardShortcutPlatform(): KeyboardShortcutPlatform {
  if (typeof navigator === "undefined") return "other";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "mac" : "other";
}

export function keyboardShortcutKeys(
  binding: KeyboardShortcutBinding | null,
  platform = keyboardShortcutPlatform(),
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
  platform = keyboardShortcutPlatform(),
): string {
  return keyboardShortcutKeys(binding, platform).join(" ");
}

export function keyboardShortcutAria(
  binding: KeyboardShortcutBinding | null,
  platform = keyboardShortcutPlatform(),
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

export function keyboardShortcutBrowserWarning(
  binding: KeyboardShortcutBinding | null,
): string | undefined {
  if (binding === null) return undefined;
  const serialized = serializeBinding(binding);
  if (["Mod+o", "Mod+w", "Mod+f", "Mod+,"].includes(serialized)) {
    return "Your browser may keep this shortcut for its own action.";
  }
  if (
    serialized === "Alt+ArrowLeft" ||
    serialized === "Alt+ArrowRight" ||
    /^Alt+[1-9]$/.test(serialized)
  ) {
    return "Your browser may use this shortcut for navigation.";
  }
  return undefined;
}

export function keyboardShortcutTextEditingWarning(
  binding: KeyboardShortcutBinding | null,
): string | undefined {
  if (binding === null) return undefined;
  return ["Mod+a", "Mod+c", "Mod+v", "Mod+x", "Mod+y", "Mod+z"].includes(
    serializeBinding(binding),
  )
    ? "This shortcut is commonly used while editing text."
    : undefined;
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
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

function command(
  id: KeyboardShortcutCommandId,
  label: string,
  group: KeyboardShortcutCommand["group"],
  contexts: KeyboardShortcutCommand["contexts"],
  key: string,
  modifiers: readonly KeyboardShortcutModifier[],
): KeyboardShortcutCommand {
  return { contexts, defaultBinding: { key, modifiers }, group, id, label };
}

function repositorySelectionCommands(): readonly KeyboardShortcutCommand[] {
  return Array.from({ length: 9 }, (_, index) => {
    const position = index + 1;
    return command(
      `projects.selectRepository${position}` as KeyboardShortcutCommandId,
      position === 9
        ? "Select last repository"
        : `Select repository ${position}`,
      "Navigation",
      ["application"],
      String(position),
      ["Alt"],
    );
  });
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
