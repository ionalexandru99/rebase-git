import { describe, expect, it } from "vite-plus/test";
import {
  defaultKeyboardShortcutBindings,
  findKeyboardShortcutConflict,
  keyboardShortcutBindingsEqual,
  keyboardShortcutFromInput,
  keyboardShortcutValidationError,
  keyboardShortcutWarning,
  matchesKeyboardShortcut,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type { KeyboardShortcutBindings } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";

describe("keyboard shortcuts", () => {
  it("captures the primary platform modifier as Mod", () => {
    expect(
      keyboardShortcutFromInput(
        keyboardInput({ ctrlKey: true, key: "O" }),
        "other",
      ),
    ).toEqual({ key: "o", modifiers: ["Mod"] });
    expect(
      keyboardShortcutFromInput(
        keyboardInput({ key: ",", metaKey: true }),
        "mac",
      ),
    ).toEqual({ key: ",", modifiers: ["Mod"] });
  });

  it("retains non-primary Control and Meta modifiers", () => {
    expect(
      keyboardShortcutFromInput(
        keyboardInput({ ctrlKey: true, key: "k" }),
        "mac",
      ),
    ).toEqual({ key: "k", modifiers: ["Control"] });
    expect(
      keyboardShortcutFromInput(
        keyboardInput({ key: "k", metaKey: true }),
        "other",
      ),
    ).toEqual({ key: "k", modifiers: ["Meta"] });
  });

  it("normalizes logical keys and ignores modifier-only input", () => {
    expect(
      keyboardShortcutFromInput(
        keyboardInput({ altKey: true, key: "ArrowLeft" }),
        "other",
      ),
    ).toEqual({ key: "ArrowLeft", modifiers: ["Alt"] });
    expect(
      keyboardShortcutFromInput(
        keyboardInput({ key: "Shift", shiftKey: true }),
        "other",
      ),
    ).toBeUndefined();
  });

  it("rejects unmodified printable and control keys", () => {
    expect(
      keyboardShortcutValidationError({ key: "Shift", modifiers: ["Mod"] }),
    ).toBe("Use a non-modifier key.");
    expect(keyboardShortcutValidationError({ key: "r", modifiers: [] })).toBe(
      "Add a modifier to use a letter, number, or symbol.",
    );
    expect(
      keyboardShortcutValidationError({ key: "Enter", modifiers: [] }),
    ).toBe("Add a modifier to use this key.");
    expect(
      keyboardShortcutValidationError({ key: "ArrowRight", modifiers: [] }),
    ).toBe("Add a modifier to use this key.");
    expect(
      keyboardShortcutValidationError({ key: "F2", modifiers: [] }),
    ).toBeUndefined();
    expect(
      keyboardShortcutValidationError({
        key: "Enter",
        modifiers: ["Mod"],
      }),
    ).toBeUndefined();
  });

  it("matches Mod only against the primary platform modifier", () => {
    const binding = { key: "o", modifiers: ["Mod"] } as const;

    expect(
      matchesKeyboardShortcut(
        keyboardInput({ ctrlKey: true, key: "o" }),
        binding,
        "other",
      ),
    ).toBe(true);
    expect(
      matchesKeyboardShortcut(
        keyboardInput({ key: "o", metaKey: true }),
        binding,
        "other",
      ),
    ).toBe(false);
    expect(
      matchesKeyboardShortcut(
        keyboardInput({ key: "o", metaKey: true }),
        binding,
        "mac",
      ),
    ).toBe(true);
  });

  it("compares bindings regardless of modifier order", () => {
    expect(
      keyboardShortcutBindingsEqual(
        { key: "o", modifiers: ["Shift", "Mod"] },
        { key: "o", modifiers: ["Mod", "Shift"] },
      ),
    ).toBe(true);
    expect(
      keyboardShortcutBindingsEqual(
        { key: "o", modifiers: ["Mod"] },
        { key: "o", modifiers: ["Mod", "Shift"] },
      ),
    ).toBe(false);
  });

  it("warns about shortcuts the browser or text editing may claim", () => {
    expect(
      keyboardShortcutWarning({ key: "1", modifiers: ["Alt"] }, "browser"),
    ).toBe("Your browser may use this shortcut for navigation.");
    expect(
      keyboardShortcutWarning({ key: "1", modifiers: ["Alt"] }, "desktop"),
    ).toBeUndefined();
    expect(
      keyboardShortcutWarning({ key: "c", modifiers: ["Mod"] }, "desktop"),
    ).toBe("This shortcut is commonly used while editing text.");
  });

  it("reports conflicts only when command contexts overlap", () => {
    const binding = { key: "o", modifiers: ["Mod", "Shift"] } as const;
    const bindings: KeyboardShortcutBindings = {
      ...defaultKeyboardShortcutBindings,
      "projects.showOpenProject": binding,
      "repositoryPicker.openSelectedRepository": binding,
      "search.focus": binding,
    };

    expect(
      findKeyboardShortcutConflict(
        bindings,
        "repositoryPicker.openSelectedRepository",
        binding,
      )?.id,
    ).toBe("search.focus");
    expect(
      findKeyboardShortcutConflict(
        {
          ...defaultKeyboardShortcutBindings,
          "projects.showOpenProject": binding,
          "repositoryPicker.openSelectedRepository": binding,
        },
        "projects.showOpenProject",
        binding,
      ),
    ).toBeUndefined();
  });
});

function keyboardInput(
  input: Partial<{
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly key: string;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
  }>,
) {
  return {
    altKey: false,
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...input,
  };
}
