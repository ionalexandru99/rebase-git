import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTimingBudget } from "#tests-performance/timing-budget";

afterEach(() => vi.restoreAllMocks());

describe("performance timing budgets", () => {
  it.each([0, 100, 109.999])(
    "accepts %s ms without warning against a 100 ms target",
    (measurement) => {
      const warning = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      assertTimingBudget("reopen", measurement, 100);
      expect(warning).not.toHaveBeenCalled();
    },
  );

  it.each([110, 119.999])(
    "warns without failing at %s ms against a 100 ms target",
    (measurement) => {
      const warning = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      assertTimingBudget("reopen", measurement, 100);
      expect(warning).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("reopen"));
    },
  );

  it.each([120, 150])(
    "fails at %s ms against a 100 ms target",
    (measurement) => {
      expect(() => assertTimingBudget("reopen", measurement, 100)).toThrow(
        "Performance timing failure: reopen",
      );
    },
  );

  it("uses the median of samples and preserves the measured values", () => {
    const samples = [5_000, 100, 90];
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    assertTimingBudget("reopen", samples, 100);
    assertTimingBudget("reopen", [90, 130, 100, 120], 100);
    expect(samples).toEqual([5_000, 100, 90]);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("110.00 ms"));
    expect(() => assertTimingBudget("reopen", [119, 121], 100)).toThrow(
      "Performance timing failure",
    );
  });

  it.each([
    undefined,
    Number.NaN,
    Infinity,
    -Infinity,
    -1,
    [],
    [1, Number.NaN, 1],
    [1, Infinity, 1],
    [1, -1, 1],
  ])("rejects invalid measurements %s", (measurement) => {
    expect(() => assertTimingBudget("reopen", measurement, 100)).toThrow(
      "timing measurements",
    );
  });

  it.each([Number.NaN, Infinity, -Infinity, 0, -1])(
    "rejects invalid target %s",
    (target) => {
      expect(() => assertTimingBudget("reopen", 100, target)).toThrow(
        "timing target",
      );
    },
  );
});
