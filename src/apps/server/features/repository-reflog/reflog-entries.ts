import type {
  ReflogAction,
  ReflogEntry,
} from "#contracts/repository-reflog/repository-reflog.contract.ts";

export interface ReflogLine {
  readonly oid: string;
  readonly recordedAt: number;
  readonly message: string;
  readonly subject: string;
}

const maximumText = 1_024;

export function parseReflog(output: string): ReflogLine[] {
  return output.split("\n").flatMap((line) => {
    const [oid, selector, message, subject] = line.split("\x1f");
    if (oid === undefined || !/^[0-9a-f]{40,64}$/.test(oid)) return [];
    return [
      {
        oid,
        recordedAt: Number(/@\{(\d+)\}$/.exec(selector ?? "")?.[1] ?? 0),
        message: message ?? "",
        subject: subject ?? "",
      },
    ];
  });
}

export function groupReflog(
  lines: readonly ReflogLine[],
  orphaned: ReadonlySet<string>,
  limit = lines.length,
): ReflogEntry[] {
  const entries: ReflogEntry[] = [];
  let index = 0;
  while (index < Math.min(limit, lines.length)) {
    const rebase = rebaseGroup(lines, index);
    const entry = rebase?.entry ?? plainEntry(lines, index);
    index = rebase?.next ?? index + 1;
    if (entry.previousOid !== entry.oid)
      entries.push({ ...entry, orphaned: orphaned.has(entry.oid) });
  }
  return entries;
}

type GroupedEntry = Omit<ReflogEntry, "orphaned">;

function rebaseGroup(
  lines: readonly ReflogLine[],
  index: number,
): { readonly entry: GroupedEntry; readonly next: number } | undefined {
  const first = lines[index];
  const step = first === undefined ? undefined : rebaseStep(first.message);
  if (first === undefined || step === undefined) return undefined;
  if (step.phase === "start")
    return {
      entry: entryOf(
        first,
        lines[index + 1],
        "rebase",
        `Rebasing onto ${step.detail.replace(/^checkout /, "")}`,
      ),
      next: index + 1,
    };
  let cursor = step.phase === "end" ? index + 1 : index;
  while (rebaseStep(lines[cursor]?.message ?? "")?.phase === "step") cursor++;
  const start = lines[cursor];
  const startStep = rebaseStep(start?.message ?? "");
  if (start === undefined || startStep?.phase !== "start") {
    if (step.phase !== "end") return undefined;
    const onto = /onto ([0-9a-f]{7})/.exec(step.detail)?.[1];
    return {
      entry: entryOf(
        first,
        lines[index + 1],
        "rebase",
        `Rebased onto ${onto ?? "a new base"}`,
      ),
      next: index + 1,
    };
  }
  const onto = startStep.detail.replace(/^checkout /, "");
  const steps = lines.slice(step.phase === "end" ? index + 1 : index, cursor);
  const description =
    step.label === "abort"
      ? `Rebase onto ${onto} aborted`
      : step.phase === "end"
        ? `Rebased onto ${onto}`
        : `Rebasing onto ${onto}`;
  return {
    entry: {
      ...entryOf(first, lines[cursor + 1], "rebase", description),
      steps: steps.map((line) => {
        const lineStep = rebaseStep(line.message);
        return {
          oid: line.oid,
          label: (lineStep?.label === "step"
            ? "pick"
            : (lineStep?.label ?? "pick")
          ).slice(0, 32),
          description: text(lineStep?.detail ?? line.message),
        };
      }),
    },
    next: cursor + 1,
  };
}

function rebaseStep(message: string) {
  const match = /^rebase(?: -[im])?(?: \(([^)]*)\)| (finished))?: (.*)$/.exec(
    message,
  );
  if (match === null) return undefined;
  const label = match[1] ?? (match[2] === undefined ? "step" : "finish");
  const phase =
    label === "start"
      ? "start"
      : label === "finish" || label === "abort"
        ? "end"
        : "step";
  return { label, phase, detail: match[3] ?? "" } as const;
}

const plainActions: readonly (readonly [
  RegExp,
  ReflogAction,
  (match: RegExpExecArray) => string,
])[] = [
  [/^commit \(amend\): (.*)$/, "amend", (m) => m[1] ?? ""],
  [/^commit \(merge\): (.*)$/, "merge", (m) => m[1] ?? ""],
  [/^commit(?: \(initial\))?: (.*)$/, "commit", (m) => m[1] ?? ""],
  [
    /^checkout: moving from (.*) to (.*)$/,
    "switch",
    (m) => `${m[1] ?? ""} → ${m[2] ?? ""}`,
  ],
  [/^reset: moving to (.*)$/, "reset", (m) => `Moved to ${m[1] ?? ""}`],
  [/^branch: (Created from .*)$/, "created", (m) => m[1] ?? ""],
  [/^branch: Reset to (.*)$/, "reset", (m) => `Moved to ${m[1] ?? ""}`],
  [/^merge (.*)$/, "merge", (m) => `Merged ${m[1] ?? ""}`],
  [/^pull\b[^:]*: (.*)$/, "pull", (m) => `Pulled: ${m[1] ?? ""}`],
  [/^cherry-pick\b[^:]*: (.*)$/, "cherry-pick", (m) => m[1] ?? ""],
];

function plainEntry(lines: readonly ReflogLine[], index: number): GroupedEntry {
  const line = lines[index] as ReflogLine;
  for (const [pattern, action, describe] of plainActions) {
    const match = pattern.exec(line.message);
    if (match !== null)
      return entryOf(line, lines[index + 1], action, describe(match));
  }
  return entryOf(line, lines[index + 1], "other", line.message);
}

function entryOf(
  line: ReflogLine,
  previous: ReflogLine | undefined,
  action: ReflogAction,
  description: string,
): GroupedEntry {
  return {
    oid: line.oid,
    previousOid: previous?.oid ?? null,
    action,
    description: text(description),
    subject: text(line.subject),
    recordedAt: Number.isFinite(line.recordedAt) ? line.recordedAt : 0,
    steps: [],
  };
}

function text(value: string) {
  return value
    .replace(/\b[0-9a-f]{40}(?:[0-9a-f]{24})?\b/g, (oid) => oid.slice(0, 7))
    .slice(0, maximumText);
}
