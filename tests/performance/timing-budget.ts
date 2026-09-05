export function assertTimingBudget(
  label: string,
  measuredMilliseconds: number | readonly number[] | undefined,
  targetMilliseconds: number,
) {
  if (!Number.isFinite(targetMilliseconds) || targetMilliseconds <= 0)
    throw new Error(
      `${label}: timing target must be finite and greater than zero`,
    );
  const samples =
    typeof measuredMilliseconds === "number"
      ? [measuredMilliseconds]
      : measuredMilliseconds;
  if (
    samples === undefined ||
    samples.length === 0 ||
    Array.from(samples).some((sample) => !Number.isFinite(sample) || sample < 0)
  )
    throw new Error(
      `${label}: timing measurements must be finite, nonnegative, and nonempty`,
    );
  const measured = median(samples);
  const ratio = measured / targetMilliseconds;
  const detail = `${label}: ${measured.toFixed(2)} ms against ${targetMilliseconds} ms target (${((ratio - 1) * 100).toFixed(1)}% over target)`;
  if (ratio >= 1.2) throw new Error(`Performance timing failure: ${detail}`);
  if (ratio >= 1.1) {
    const warning = `Performance timing warning: ${detail}`;
    console.warn(
      process.env.GITHUB_ACTIONS === "true"
        ? `::warning title=Performance timing::${warning.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`
        : warning,
    );
  }
}

function median(samples: readonly number[]) {
  const sorted = samples.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) throw new Error("Timing samples are empty");
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  if (lower === undefined) throw new Error("Timing samples are empty");
  return lower / 2 + upper / 2;
}
