import { describe, expect, it } from "vite-plus/test";
import { remoteProvidersFromConfig } from "#server/features/repository-refs/git/remote-providers";

describe("remote providers", () => {
  it.each([
    ["git@github.com:alex/rebase.git", "github"],
    ["ssh://git@ssh.github.com:443/alex/rebase.git", "github"],
    ["https://gitlab.com/team/repo.git", "gitlab"],
    ["ssh://git@gitlab.company.test/team/repo.git", "gitlab"],
    ["git@bitbucket.org:team/repo.git", "bitbucket"],
    ["git@ssh.dev.azure.com:v3/team/project/repo", "azure"],
    ["https://team.visualstudio.com/project/_git/repo", "azure"],
    ["git@codeberg.org:team/repo.git", "codeberg"],
    ["https://gitea.company.test/team/repo.git", "gitea"],
    ["ssh://git@forgejo.company.test/team/repo.git", "forgejo"],
    ["https://git-codecommit.eu-west-1.amazonaws.com/v1/repos/repo", "aws"],
    ["https://github.com.example.test/team/repo.git", "git"],
    ["/local/repo", "git"],
  ])("identifies %s", (address, provider) => {
    expect(remoteProvidersFromConfig(`remote.origin.url ${address}`)).toEqual([
      { remote: "origin", provider },
    ]);
  });
  it("keeps separate remote identities and excludes URLs from the result", () => {
    expect(
      remoteProvidersFromConfig(
        "remote.origin.url https://token@github.com/alex/repo.git\nremote.upstream.url git@gitlab.com:team/repo.git",
      ),
    ).toEqual([
      { remote: "origin", provider: "github" },
      { remote: "upstream", provider: "gitlab" },
    ]);
  });
});
