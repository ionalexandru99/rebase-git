import { afterEach, describe, expect, it, vi } from "vitest";
import { createRepositoryHistoryRequestId } from "#web/features/repository-history/repository-history-request-id";

afterEach(() => vi.unstubAllGlobals());

describe("repository history request ids", () => {
  it("formats secure random bytes as a UUID without crypto.randomUUID", () => {
    const getRandomValues = vi.fn((values: Uint8Array) => {
      values.fill(1);
      return values;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    expect(createRepositoryHistoryRequestId()).toBe(
      "01010101-0101-4101-8101-010101010101",
    );
    expect(getRandomValues).toHaveBeenCalledOnce();
  });
});
