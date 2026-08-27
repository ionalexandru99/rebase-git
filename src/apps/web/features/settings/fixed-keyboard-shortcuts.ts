import type { KeyboardShortcutGroup } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";

export interface FixedKeyboardShortcut {
  readonly group: KeyboardShortcutGroup;
  readonly keys: readonly string[];
  readonly label: string;
}

export const fixedKeyboardShortcuts: readonly FixedKeyboardShortcut[] = [
  { group: "Navigation", keys: ["Esc"], label: "Close the active panel" },
  { group: "Branches", keys: ["/"], label: "Filter branches" },
  { group: "Branches", keys: ["↑", "↓"], label: "Move through branches" },
  {
    group: "Branches",
    keys: ["←", "→"],
    label: "Collapse or expand a section",
  },
  {
    group: "Branches",
    keys: ["Enter"],
    label: "Check out the selected branch or tag",
  },
  {
    group: "Search and lists",
    keys: ["↑", "↓"],
    label: "Move through results",
  },
  {
    group: "Search and lists",
    keys: ["Enter"],
    label: "Open the active result",
  },
  { group: "Folder picker", keys: ["←"], label: "Open the parent folder" },
  { group: "Folder picker", keys: ["→"], label: "Enter the selected folder" },
  {
    group: "Folder picker",
    keys: ["Alt", "↑"],
    label: "Open the parent folder",
  },
];
