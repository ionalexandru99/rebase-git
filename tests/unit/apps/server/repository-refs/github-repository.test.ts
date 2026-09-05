import { describe, expect, it } from "vite-plus/test";
import { githubRepositoryFromRemotes } from "#server/features/repository-refs/git/github-repository";

describe("GitHub repository identity", () => {
  it.each([
    "https://github.com/alex/rebase.git",
    "git@github.com:alex/rebase.git",
    "ssh://git@github.com/alex/rebase",
  ])("reads %s", (url) => {
    expect(githubRepositoryFromRemotes(`remote.origin.url ${url}`)).toEqual({
      owner: "alex",
      name: "rebase",
    });
  });

  it("does not send credentials or guess a repository across unrelated remotes", () => {
    expect(
      githubRepositoryFromRemotes(
        "remote.origin.url https://token@github.com/alex/private.git",
      ),
    ).toBeUndefined();
    expect(
      githubRepositoryFromRemotes(
        "remote.origin.url https://bitbucket.org/alex/rebase.git\nremote.upstream.url https://github.com/alex/rebase.git",
      ),
    ).toBeUndefined();
    expect(
      githubRepositoryFromRemotes(
        "remote.one.url https://github.com/a/b.git\nremote.two.url https://github.com/c/d.git",
      ),
    ).toBeUndefined();
  });
});
