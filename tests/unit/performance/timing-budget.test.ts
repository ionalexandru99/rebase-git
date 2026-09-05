import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTimingBudget } from "#tests-performance/timing-budget";

beforeEach(() => {
  vi.stubEnv("PERFORMANCE_RECORD_BASELINE", undefined);
  vi.stubEnv("PERFORMANCE_BASELINE", undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("performance timing budgets", () => {
  it("rejects conflicting baseline modes", () => {
    vi.stubEnv("PERFORMANCE_RECORD_BASELINE", "record.jsonl");
    vi.stubEnv("PERFORMANCE_BASELINE", "baseline.jsonl");
    expect(() => assertTimingBudget("reopen", 100, 100)).toThrow(
      "modes cannot be combined",
    );
  });
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

  it("publishes warnings as escaped GitHub Actions annotations", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    assertTimingBudget("reopen\n100%", 110, 100);
    expect(warning).toHaveBeenCalledWith(
      "::warning title=Performance timing::Performance timing warning: reopen%0A100%25: 110.00 ms against 100 ms target (10.0%25 over target)",
    );
  });

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
