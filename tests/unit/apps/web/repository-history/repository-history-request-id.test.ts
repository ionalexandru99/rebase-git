import { describe, expect, it, vi } from "vitest";
import { createRepositoryHistoryRequestId } from "#web/features/repository-history/repository-history-request-id";

describe("repository history request ids", () => {
  it("creates an id when Web Crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    expect(createRepositoryHistoryRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    vi.unstubAllGlobals();
  });

  it("does not require crypto.randomUUID", () => {
    const getRandomValues = vi.fn((values: Uint8Array) => {
      values.fill(1);
      return values;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    const first = createRepositoryHistoryRequestId();
    const second = createRepositoryHistoryRequestId();

    expect(first).not.toBe(second);
    expect(getRandomValues).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
