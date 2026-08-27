import type { KeyboardShortcutHost } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";

export function browserKeyboardShortcutHost(): KeyboardShortcutHost {
  return {
    client: window.rebaseHost === undefined ? "browser" : "desktop",
    platform: /Mac|iPhone|iPad/.test(navigator.platform) ? "mac" : "other",
  };
}
