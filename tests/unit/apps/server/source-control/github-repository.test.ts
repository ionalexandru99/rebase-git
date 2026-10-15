import { describe, expect, it } from "vite-plus/test";
import { createGitHubHost } from "#server/features/source-control/hosts/github-host.ts";
import { fakeGitHub } from "#tests-support/git-hosts/github.ts";

const github = createGitHubHost(fakeGitHub({}).github);

describe("GitHub repository identity", () => {
  it.each([
    "https://github.com/Alex/Rebase.git",
    "git@github.com:alex/rebase.git",
    "ssh://git@github.com/alex/rebase",
  ])("reads %s", (url) => {
    expect(github.repositoryId(url)).toBe("alex/rebase");
  });

  it.each([
    "https://github.com/alex/rebase/tree/main",
    "https://gitlab.com/alex/rebase.git",
    "https://github.com/alex/..",
  ])("does not read %s", (url) => {
    expect(github.repositoryId(url)).toBeUndefined();
  });
});
