import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

interface TimingBaseline {
  readonly label: string;
  readonly medianMilliseconds: number;
  readonly targetMilliseconds: number;
}

export function recordTimingBaseline(
  path: string,
  label: string,
  medianMilliseconds: number,
  targetMilliseconds: number,
) {
  if (existsSync(path) && readRecords(path).has(label))
    throw new Error(`Duplicate performance baseline: ${label}`);
  const record: TimingBaseline = {
    label,
    medianMilliseconds,
    targetMilliseconds,
  };
  validateRecord(record);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

export function readTimingBaseline(
  path: string,
  label: string,
  targetMilliseconds: number,
) {
  const record = readRecords(path).get(label);
  if (record === undefined)
    throw new Error(`Missing performance baseline: ${label}`);
  if (record.targetMilliseconds !== targetMilliseconds)
    throw new Error(
      `Performance baseline target mismatch for ${label}: recorded ${record.targetMilliseconds} ms, current ${targetMilliseconds} ms`,
    );
  return record.medianMilliseconds;
}

function readRecords(path: string) {
  const records = new Map<string, TimingBaseline>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const value: unknown = JSON.parse(line);
    validateRecord(value);
    if (records.has(value.label))
      throw new Error(`Duplicate performance baseline: ${value.label}`);
    records.set(value.label, value);
  }
  return records;
}

function validateRecord(value: unknown): asserts value is TimingBaseline {
  if (
    typeof value !== "object" ||
    value === null ||
    !("label" in value) ||
    typeof value.label !== "string" ||
    value.label.length === 0 ||
    !("medianMilliseconds" in value) ||
    typeof value.medianMilliseconds !== "number" ||
    !Number.isFinite(value.medianMilliseconds) ||
    value.medianMilliseconds < 0 ||
    !("targetMilliseconds" in value) ||
    typeof value.targetMilliseconds !== "number" ||
    !Number.isFinite(value.targetMilliseconds) ||
    value.targetMilliseconds <= 0
  )
    throw new Error("Invalid performance baseline record");
}
