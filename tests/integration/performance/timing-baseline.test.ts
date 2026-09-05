import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTimingBudget } from "#tests-performance/timing-budget";

let directory: string;
let baselinePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "performance-baseline-"));
  baselinePath = join(directory, "baseline.jsonl");
  vi.stubEnv("PERFORMANCE_RECORD_BASELINE", undefined);
  vi.stubEnv("PERFORMANCE_BASELINE", undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("performance timing baselines", () => {
  it("records validated medians above target and compares the candidate against those records", () => {
    vi.stubEnv("PERFORMANCE_RECORD_BASELINE", baselinePath);
    assertTimingBudget("reopen", [200, 5_000, 190], 100);
    assertTimingBudget("search", [40, 60], 100);
    expect(
      readFileSync(baselinePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      { label: "reopen", medianMilliseconds: 200, targetMilliseconds: 100 },
      { label: "search", medianMilliseconds: 50, targetMilliseconds: 100 },
    ]);
    expect(console.warn).not.toHaveBeenCalled();
    vi.stubEnv("PERFORMANCE_RECORD_BASELINE", undefined);
    vi.stubEnv("PERFORMANCE_BASELINE", baselinePath);
    assertTimingBudget("reopen", [210, 220, 230], 100);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("200 ms baseline"),
    );
    expect(() => assertTimingBudget("reopen", 240, 100)).toThrow(
      "Performance timing failure",
    );
    assertTimingBudget("search", 60, 100);
    expect(() => assertTimingBudget("search", 120, 100)).toThrow(
      "Performance timing failure",
    );
  });

  it("keeps a fast path within target despite a large relative baseline change", () => {
    vi.stubEnv("PERFORMANCE_RECORD_BASELINE", baselinePath);
    assertTimingBudget("feedback", 7.8, 50);
    vi.stubEnv("PERFORMANCE_RECORD_BASELINE", undefined);
    vi.stubEnv("PERFORMANCE_BASELINE", baselinePath);
    assertTimingBudget("feedback", 10.1, 50);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("29.5% over baseline"),
    );
    assertTimingBudget("feedback", 55, 50);
    expect(console.warn).toHaveBeenCalledOnce();
    expect(() => assertTimingBudget("feedback", 60, 50)).toThrow(
      "Performance timing failure",
    );
  });

  it("does not record invalid measurements or duplicate labels", () => {
    vi.stubEnv("PERFORMANCE_RECORD_BASELINE", baselinePath);
    assertTimingBudget("reopen", 200, 100);
    expect(() => assertTimingBudget("reopen", 100, 100)).toThrow(
      "Duplicate performance baseline",
    );
    expect(() =>
      assertTimingBudget("search", [100, Number.NaN, 100], 100),
    ).toThrow("timing measurements");
    expect(readFileSync(baselinePath, "utf8").trim().split("\n")).toHaveLength(
      1,
    );
  });

  it("rejects missing files, missing labels, duplicate records, and changed targets", () => {
    vi.stubEnv("PERFORMANCE_BASELINE", baselinePath);
    expect(() => assertTimingBudget("reopen", 100, 100)).toThrow();
    const record = JSON.stringify({
      label: "reopen",
      medianMilliseconds: 100,
      targetMilliseconds: 100,
    });
    writeFileSync(baselinePath, `${record}\n`);
    expect(() => assertTimingBudget("other", 100, 100)).toThrow(
      "Missing performance baseline",
    );
    expect(() => assertTimingBudget("reopen", 100, 200)).toThrow(
      "target mismatch",
    );
    writeFileSync(baselinePath, `${record}\n${record}\n`);
    expect(() => assertTimingBudget("reopen", 100, 100)).toThrow(
      "Duplicate performance baseline",
    );
  });

  it.each([
    "null",
    '{"label":"reopen","medianMilliseconds":null,"targetMilliseconds":100}',
    '{"label":"reopen","medianMilliseconds":1e400,"targetMilliseconds":100}',
    '{"label":"reopen","medianMilliseconds":-1,"targetMilliseconds":100}',
    '{"label":"reopen","medianMilliseconds":100,"targetMilliseconds":0}',
    '{"label":"reopen","medianMilliseconds":100,"targetMilliseconds":1e400}',
  ])("rejects invalid baseline record %s", (record) => {
    vi.stubEnv("PERFORMANCE_BASELINE", baselinePath);
    writeFileSync(baselinePath, `${record}\n`);
    expect(() => assertTimingBudget("reopen", 100, 100)).toThrow(
      "Invalid performance baseline record",
    );
  });

  it("uses the positive configured target when the recorded baseline is zero", () => {
    vi.stubEnv("PERFORMANCE_RECORD_BASELINE", baselinePath);
    assertTimingBudget("reopen", 0, 100);
    vi.stubEnv("PERFORMANCE_RECORD_BASELINE", undefined);
    vi.stubEnv("PERFORMANCE_BASELINE", baselinePath);
    assertTimingBudget("reopen", 0, 100);
    assertTimingBudget("reopen", 0.001, 100);
    expect(console.warn).not.toHaveBeenCalled();
    assertTimingBudget("reopen", 110, 100);
    expect(console.warn).toHaveBeenCalledOnce();
    expect(() => assertTimingBudget("reopen", 120, 100)).toThrow(
      "Performance timing failure",
    );
  });
});
