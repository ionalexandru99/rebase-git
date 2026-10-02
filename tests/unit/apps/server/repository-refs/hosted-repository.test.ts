import { describe, expect, it } from "vite-plus/test";
import { hostedRepositoryFromRemotes } from "#server/features/repository-refs/git/read-repository-refs.ts";

describe("hosted repository identity", () => {
  it.each([
    ["https://github.com/alex/rebase.git", "github"],
    ["git@github.com:alex/rebase.git", "github"],
    ["ssh://git@github.com/alex/rebase", "github"],
    ["https://alex@bitbucket.org/alex/rebase.git", "bitbucket"],
    ["git@codeberg.org:alex/rebase.git", "codeberg"],
  ])("reads %s", (url, provider) => {
    expect(hostedRepositoryFromRemotes(`remote.origin.url ${url}`)).toEqual({
      provider,
      owner: "alex",
      name: "rebase",
    });
  });

  it.each([
    ["git@gitlab.com:group/sub/rebase.git", "gitlab"],
    ["https://dev.azure.com/org/project/_git/rebase", "azure"],
  ])("needs only the host for %s", (url, provider) => {
    expect(hostedRepositoryFromRemotes(`remote.origin.url ${url}`)).toEqual({
      provider,
    });
  });

  it("does not guess a repository across unrelated remotes or hosts", () => {
    expect(
      hostedRepositoryFromRemotes(
        "remote.origin.url https://git.example.com/alex/rebase.git\nremote.upstream.url https://github.com/alex/rebase.git",
      ),
    ).toBeUndefined();
    expect(
      hostedRepositoryFromRemotes(
        "remote.one.url https://github.com/a/b.git\nremote.two.url https://github.com/c/d.git",
      ),
    ).toBeUndefined();
    expect(
      hostedRepositoryFromRemotes(
        "remote.origin.url https://github.com/alex/rebase/tree/main",
      ),
    ).toBeUndefined();
  });
});
