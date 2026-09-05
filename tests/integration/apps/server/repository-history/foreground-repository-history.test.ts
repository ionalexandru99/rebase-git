import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { ReadRepositoryHistory } from "@rebase/contracts";
import { createLocalGitCommandRunner } from "@rebase/server/adapters/local-git/local-git-command-runner";
import { readRepositoryHistory } from "@rebase/server/features/repository-history/git/read-repository-history";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      }),
    ),
  );
});

describe("foreground history selection", () => {
  it.each(["sha1", "sha256"] as const)(
    "returns consecutive first-parent windows before reading merged side history (%s)",
    async (objectFormat) => {
      const path = await createHistory(objectFormat);
      const expected = (
        await git(
          path,
          "rev-list",
          "--first-parent",
          "--topo-order",
          "--max-count=200",
          "main",
        )
      ).split("\n");
      const first = await read(path, {});
      const second = await read(path, { offset: 100 });
      expect(first.commits.map(({ oid }) => oid)).toEqual(
        expected.slice(0, 100),
      );
      expect(second.commits.map(({ oid }) => oid)).toEqual(expected.slice(100));
      expect(first.commits[0]?.parents).toEqual(
        (await git(path, "rev-list", "--parents", "--max-count=1", "main"))
          .split(" ")
          .slice(1),
      );
      expect(
        new Set([...first.commits, ...second.commits].map(({ oid }) => oid))
          .size,
      ).toBe(200);
      const chronological = await read(path, {
        order: "chronological",
        offset: 100,
      });
      expect(chronological.commits.map(({ oid }) => oid)).toEqual(
        expected.slice(100),
      );
    },
  );

  it("reveals selected secondary parents only after their child becomes reachable", async () => {
    const path = await createHistory("sha1");
    const outer = await git(path, "rev-parse", "main");
    const inner = await git(path, "rev-parse", "side");
    const nested = await git(path, "rev-parse", "nested");
    const hiddenEdge = { childOid: inner, parentOid: nested };
    const collapsed = await read(path, {
      additionalParentEdges: [
        hiddenEdge,
        { childOid: outer, parentOid: nested },
      ],
    });
    expect(
      collapsed.commits.some(({ oid }) => oid === inner || oid === nested),
    ).toBe(false);
    const expanded = await read(path, {
      additionalParentEdges: [
        { childOid: outer, parentOid: inner },
        hiddenEdge,
      ],
    });
    const expandedOids = expanded.commits.map(({ oid }) => oid);
    expect(expandedOids.indexOf(outer)).toBeLessThan(
      expandedOids.indexOf(inner),
    );
    expect(expandedOids.indexOf(inner)).toBeLessThan(
      expandedOids.indexOf(nested),
    );
    expect(expandedOids).toContain(nested);
    const expected = (
      await git(
        path,
        "rev-list",
        "--first-parent",
        "--topo-order",
        "--max-count=200",
        ...[outer, inner, nested].sort(),
      )
    ).split("\n");
    const next = await read(path, {
      offset: 100,
      additionalParentEdges: [
        { childOid: outer, parentOid: inner },
        hiddenEdge,
      ],
    });
    expect([...expandedOids, ...next.commits.map(({ oid }) => oid)]).toEqual(
      expected,
    );
    const independent = await read(path, {
      roots: [
        { name: "main", type: "branch", oid: outer },
        { name: "side", type: "branch", oid: inner },
      ],
      additionalParentEdges: [hiddenEdge],
    });
    expect(independent.commits.some(({ oid }) => oid === nested)).toBe(true);
  });

  it("preserves real parent vectors at shallow first-parent boundaries", async () => {
    const path = await createHistory("sha1");
    const shallow = `${path}-shallow`;
    directories.push(shallow);
    await execute("git", [
      "clone",
      "--quiet",
      "--depth=2",
      "--branch=main",
      pathToFileURL(path).href,
      shallow,
    ]);
    const page = await read(shallow, {});
    expect(page.commits).toHaveLength(2);
    expect(page.commits[1]?.parents).toEqual([
      await git(path, "rev-parse", "main~2"),
    ]);
  });
});

async function read(path: string, query: Partial<ReadRepositoryHistory>) {
  return Effect.runPromise(
    readRepositoryHistory(createLocalGitCommandRunner(), path, {
      _tag: "ReadRepositoryHistory",
      ancestry: "first-parent",
      limit: 100,
      order: "topological",
      repositoryId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000011",
      roots: [
        {
          name: "main",
          type: "branch",
          oid: await git(path, "rev-parse", "main"),
        },
      ],
      ...query,
    }),
  );
}

async function git(path: string, ...arguments_: string[]) {
  return (await execute("git", ["-C", path, ...arguments_])).stdout.trim();
}

async function createHistory(objectFormat: "sha1" | "sha256") {
  const path = await mkdtemp(join(tmpdir(), "rebase-foreground-"));
  directories.push(path);
  await git(path, "init", `--object-format=${objectFormat}`, "-b", "main");
  const commands: string[] = [];
  let mark = 0;
  const commit = (
    branch: string,
    parents: readonly number[],
    timestamp?: number,
  ) => {
    mark += 1;
    const subject = `${branch} ${mark}`;
    commands.push(
      `commit refs/heads/${branch}\nmark :${mark}\ncommitter Rebase <rebase@example.test> ${timestamp ?? 1_700_000_000 + mark} +0000\ndata ${Buffer.byteLength(subject)}\n${subject}\n`,
      ...parents.map(
        (parent, index) => `${index === 0 ? "from" : "merge"} :${parent}\n`,
      ),
      "\n",
    );
    return mark;
  };
  const base = commit("main", []);
  let main = base;
  for (let index = 0; index < 300; index += 1) main = commit("main", [main]);
  let side = base;
  for (let index = 0; index < 600; index += 1) side = commit("side", [side]);
  let nested = base;
  for (let index = 0; index < 100; index += 1)
    nested = commit("nested", [nested]);
  side = commit("side", [side, nested], 1_700_000_010);
  commit("main", [main, side], 1_700_000_005);
  const imported = execute("git", ["-C", path, "fast-import", "--quiet"]);
  imported.child.stdin?.end(`${commands.join("")}done\n`);
  await imported;
  return path;
}
