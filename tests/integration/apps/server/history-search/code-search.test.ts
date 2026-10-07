import { describe, expect, it, onTestFinished } from "vite-plus/test";
import {
  type CodeMatch,
  HistorySearchApi,
  type SearchCode,
} from "#contracts/history-search/history-search.contract.ts";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { createCodeSearchRepository, git } from "#tests-support/git.ts";
import { openTestServer } from "#tests-support/server.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";
import { environmentSubscriptions } from "#web/platform/environment/environment-connection.ts";

describe("code search", () => {
  it("finds commits whose changed lines contain the text, newest first, within a path", async () => {
    const { search, commits } = await codeSearch();

    const everywhere = await search({ text: "needle" });
    const plainText = await search({ text: "needle(" });
    const inSource = await search({ text: "needle", path: "src" });

    expect(everywhere.matches).toEqual([
      { oid: commits[0], paths: ["docs/needle notes.md"] },
      { oid: commits[1], paths: ["src/search.ts"] },
      { oid: commits[3], paths: ["src/search.ts"] },
    ]);
    expect(everywhere.progress.at(-1)).toBe(100);
    expect(plainText.matches).toEqual([
      { oid: commits[0], paths: ["docs/needle notes.md"] },
    ]);
    expect(inSource.matches.map((match) => match.oid)).toEqual([
      commits[1],
      commits[3],
    ]);
  });
});

async function codeSearch() {
  const directory = await createCodeSearchRepository();
  onTestFinished(() => removeTemporaryDirectory(directory));
  const server = await openTestServer();
  const requests = server.requests(server.owner);
  const { id: repositoryId } = await requests(RepositoryCatalogApi.remember, {
    path: directory,
  });
  const subscribe = environmentSubscriptions(
    (await server.connect(server.owner)).rpc,
  );
  const commits = (await git(directory, "rev-list", "main")).split("\n");
  return {
    commits,
    search: async (
      input: Pick<SearchCode, "text"> & Partial<Pick<SearchCode, "path">>,
    ) => {
      const matches: CodeMatch[] = [];
      const progress: number[] = [];
      await subscribe(
        HistorySearchApi.code,
        {
          repositoryId,
          worktreePath: directory,
          roots: [commits[0] ?? ""],
          ...input,
        },
        (update) => {
          if (update._tag === "CodeMatches") matches.push(...update.matches);
          else progress.push(update.percent);
        },
        new AbortController().signal,
      );
      return { matches, progress };
    },
  };
}
