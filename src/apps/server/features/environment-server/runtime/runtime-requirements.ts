import { execFile } from "node:child_process";
import { Effect } from "effect";
import { RuntimeRequirementsError } from "#server/features/environment-server/runtime/runtime-errors.contract";

const minimumNode22Version = [22, 18, 0] as const;
const minimumGitVersion = [2, 34, 0] as const;

export const verifyRuntimeRequirements = Effect.gen(function* () {
  yield* captureRequirement(() =>
    assertSupportedNodeVersion(process.versions.node),
  );

  const gitVersion = yield* readGitVersion();
  yield* captureRequirement(() => assertSupportedGitVersion(gitVersion));
});

export function assertSupportedNodeVersion(version: string) {
  const parsed = parseVersion(version, "Node");
  const supportsNode =
    parsed[0] === 24 ||
    (parsed[0] === 22 && compareVersions(parsed, minimumNode22Version) >= 0);
  if (!supportsNode) {
    throw new Error(`Node 22.18 or 24 is required. Found Node ${version}.`);
  }
}

export function assertSupportedGitVersion(version: string) {
  const parsed = parseVersion(version, "Git");
  if (compareVersions(parsed, minimumGitVersion) < 0) {
    throw new Error(`Git 2.34 or newer is required. Found Git ${version}.`);
  }
}

export function parseGitVersion(output: string) {
  const match = output.match(/^git version (\d+\.\d+\.\d+)/i);
  if (!match?.[1]) {
    throw new Error(
      `Could not determine the Git version from "${output.trim()}".`,
    );
  }

  return match[1];
}

function readGitVersion() {
  return Effect.callback<string, RuntimeRequirementsError>((resume, signal) => {
    execFile(
      "git",
      ["--version"],
      { encoding: "utf8", signal, timeout: 5_000 },
      (error, stdout) => {
        if (!error) {
          resume(captureRequirement(() => parseGitVersion(stdout)));
          return;
        }

        const message =
          error.code === "ENOENT"
            ? "Git 2.34 or newer is required, but Git was not found."
            : `Could not run Git: ${error.message}`;
        resume(
          Effect.fail(new RuntimeRequirementsError({ cause: error, message })),
        );
      },
    );
  });
}

function captureRequirement<A>(check: () => A) {
  return Effect.try({
    try: check,
    catch: (cause) =>
      new RuntimeRequirementsError({
        cause,
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
}

function parseVersion(version: string, product: "Git" | "Node") {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new Error(`Could not parse ${product} version "${version}".`);
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function compareVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  for (const index of [0, 1, 2] as const) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }

  return 0;
}
