import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const releaseSha = "1234567890abcdef1234567890abcdef12345678";
const workflow = await readFile(
  resolve(".github/workflows/release.yml"),
  "utf8",
);
const validationJob = workflow
  .split("\n  validation:\n")[1]
  ?.split("\n  package:\n")[0];
const gate = validationJob
  ?.split("        run: |\n")[1]
  ?.replace(/^ {10}/gm, "");
assert.ok(gate, "Expected the release validation gate script");

const matchingResult = {
  headSha: releaseSha,
  status: "completed",
  conclusion: "success",
  url: "https://github.com/example/repo/actions/runs/123",
};

const scenarios = [
  {
    name: "matching successful validation",
    result: matchingResult,
    accepted: true,
  },
  {
    name: "missing validation",
    runId: "",
    result: matchingResult,
    accepted: false,
  },
  {
    name: "failed validation",
    watchExit: 1,
    result: { ...matchingResult, conclusion: "failure" },
    accepted: false,
  },
  {
    name: "cancelled validation",
    result: { ...matchingResult, conclusion: "cancelled" },
    accepted: false,
  },
  {
    name: "unfinished validation",
    result: { ...matchingResult, status: "in_progress", conclusion: null },
    accepted: false,
  },
  {
    name: "success for a different commit",
    result: {
      ...matchingResult,
      headSha: "abcdef1234567890abcdef1234567890abcdef1234",
    },
    accepted: false,
  },
  {
    name: "failed rerun of matching validation",
    result: { ...matchingResult, conclusion: "failure" },
    accepted: false,
  },
] as const;

for (const scenario of scenarios) {
  test(`release gate ${scenario.accepted ? "accepts" : "rejects"} ${scenario.name}`, {
    skip: process.platform === "win32",
    timeout: 10_000,
  }, async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "rebase-release-gate-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const shellEnvironment = join(directory, "github-cli.sh");
    await writeFile(
      shellEnvironment,
      `gh() {
  printf '%s\\n' "$*" >> "$TEST_GH_CALLS"
  case "$1 $2" in
    'run list') printf '%s\\n' "$TEST_RUN_ID" ;;
    'run watch') return "$TEST_WATCH_EXIT" ;;
    'run view') printf '%s\\n' "$TEST_RUN_RESULT" ;;
    *) return 99 ;;
  esac
}
`,
    );
    const summaryPath = join(directory, "summary");
    const callsPath = join(directory, "calls");
    const result = execute("bash", ["-e", "-o", "pipefail", "-c", gate], {
      cwd: directory,
      env: {
        ...process.env,
        BASH_ENV: shellEnvironment,
        GITHUB_STEP_SUMMARY: summaryPath,
        RELEASE_SHA: releaseSha,
        TEST_GH_CALLS: callsPath,
        TEST_RUN_ID: "runId" in scenario ? scenario.runId : "123",
        TEST_RUN_RESULT: JSON.stringify(scenario.result),
        TEST_WATCH_EXIT: String(
          "watchExit" in scenario ? scenario.watchExit : 0,
        ),
      },
    });

    if (scenario.accepted) {
      await result;
      assert.equal(
        await readFile(summaryPath, "utf8"),
        `Validated release commit: ${releaseSha}\nValidation: ${matchingResult.url}\n`,
      );
    } else {
      await assert.rejects(result);
      await assert.rejects(readFile(summaryPath), { code: "ENOENT" });
    }
    const calls = await readFile(callsPath, "utf8");
    assert.ok(
      calls.startsWith(
        `run list --workflow validation.yml --event push --branch main --commit ${releaseSha} --limit 1 `,
      ),
    );
    if (!("runId" in scenario)) {
      assert.ok(calls.includes("run watch 123 --exit-status --interval 15\n"));
    }
  });
}
