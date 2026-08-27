import { describe, expect, it } from "vite-plus/test";
import { createKeyboardShortcutStore } from "#web/features/keyboard-shortcuts/keyboard-shortcut-store";

describe("keyboard shortcut store", () => {
  it("persists changed and cleared bindings across client restarts", () => {
    const storage = memoryStorage();
    const store = createKeyboardShortcutStore(storage);

    store.setBinding("projects.toggleSidebar", {
      key: "s",
      modifiers: ["Mod", "Shift"],
    });
    store.setBinding("projects.browseRepository", null);

    const restarted = createKeyboardShortcutStore(storage);

    expect(restarted.getSnapshot().bindings["projects.toggleSidebar"]).toEqual({
      key: "s",
      modifiers: ["Mod", "Shift"],
    });
    expect(
      restarted.getSnapshot().bindings["projects.browseRepository"],
    ).toBeNull();
  });

  it("resets one binding or every binding to defaults", () => {
    const storage = memoryStorage();
    const store = createKeyboardShortcutStore(storage);
    store.setBinding("projects.toggleSidebar", null);
    store.setBinding("projects.browseRepository", null);

    store.resetBinding("projects.toggleSidebar");

    expect(store.getSnapshot().bindings["projects.toggleSidebar"]).toEqual({
      key: "b",
      modifiers: ["Mod"],
    });
    expect(
      store.getSnapshot().bindings["projects.browseRepository"],
    ).toBeNull();

    store.resetAll();

    expect(store.getSnapshot().modifiedCommandIds).toEqual([]);
    expect(store.getSnapshot().bindings["projects.browseRepository"]).toEqual({
      key: "o",
      modifiers: ["Mod"],
    });
  });

  it("keeps bindings unique when resetting a displaced command", () => {
    const store = createKeyboardShortcutStore(memoryStorage());
    store.setBinding(
      "projects.toggleSidebar",
      { key: "o", modifiers: ["Mod", "Shift"] },
      "projects.showOpenProject",
    );

    store.resetBinding("projects.showOpenProject");

    expect(store.getSnapshot().bindings["projects.showOpenProject"]).toEqual({
      key: "o",
      modifiers: ["Mod", "Shift"],
    });
    expect(store.getSnapshot().bindings["projects.toggleSidebar"]).toBeNull();
  });

  it("retains valid overrides and ignores stale or malformed entries", () => {
    const storage = memoryStorage({
      "rebase.keyboard-shortcuts.v1": JSON.stringify({
        bindings: {
          "projects.toggleSidebar": {
            key: "p",
            modifiers: ["Mod", "Shift"],
          },
          "projects.browseRepository": { key: 12, modifiers: ["Mod"] },
          "removed.command": { key: "x", modifiers: ["Mod"] },
        },
        version: 1,
      }),
    });

    const store = createKeyboardShortcutStore(storage);

    expect(store.getSnapshot().bindings["projects.toggleSidebar"]).toEqual({
      key: "p",
      modifiers: ["Mod", "Shift"],
    });
    expect(store.getSnapshot().bindings["projects.browseRepository"]).toEqual({
      key: "o",
      modifiers: ["Mod"],
    });
    expect(store.getSnapshot().modifiedCommandIds).toEqual([
      "projects.toggleSidebar",
    ]);
  });
});

function memoryStorage(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
