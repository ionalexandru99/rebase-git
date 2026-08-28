import { afterEach, describe, expect, it, vi } from "vitest";
import { browserKeyboardShortcutStorage } from "#web/features/keyboard-shortcuts/browser-keyboard-shortcut-storage";

const storageKey = "rebase.keyboard-shortcuts.integration";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(storageKey);
});

describe("browser keyboard shortcut storage", () => {
  it("reads, writes, and removes values through localStorage", () => {
    const storage = browserKeyboardShortcutStorage();

    storage.setItem(storageKey, "binding");

    expect(localStorage.getItem(storageKey)).toBe("binding");
    expect(storage.getItem(storageKey)).toBe("binding");

    storage.removeItem(storageKey);

    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("falls back when localStorage operations fail", () => {
    const storage = browserKeyboardShortcutStorage();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable.");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable.");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable.");
    });

    expect(storage.getItem(storageKey)).toBeNull();
    expect(() => storage.setItem(storageKey, "binding")).not.toThrow();
    expect(() => storage.removeItem(storageKey)).not.toThrow();
  });
});
