import { describe, expect, it } from "vite-plus/test";
import {
  isSamePullRequestLink,
  pullRequestNumber,
} from "#contracts/pull-requests/pull-requests.contract.ts";

describe("Pull request references", () => {
  it("reads a number from a typed number or a pull request link", () => {
    expect(pullRequestNumber(" 421 ")).toBe(421);
    expect(pullRequestNumber("#421")).toBe(421);
    expect(pullRequestNumber("!12")).toBe(12);
    expect(pullRequestNumber("https://github.com/octo/rebase/pull/421")).toBe(
      421,
    );
    expect(
      pullRequestNumber("https://gitlab.com/group/sub/app/-/merge_requests/7"),
    ).toBe(7);

    for (const reference of [
      "",
      "0",
      "4.2",
      "1234567890",
      "#",
      "https://github.com/octo/rebase/issues/421",
      "https://github.com/octo/rebase/pull/421?tab=files",
    ])
      expect(pullRequestNumber(reference)).toBeUndefined();
  });

  it("accepts a found pull request only when a pasted link points at it", () => {
    const url = "https://github.com/Octo/rebase/pull/421";

    expect(isSamePullRequestLink(url, "421")).toBe(true);
    expect(
      isSamePullRequestLink(url, "https://github.com/octo/Rebase/pull/421"),
    ).toBe(true);
    expect(
      isSamePullRequestLink(url, "https://github.com/octo/other/pull/421"),
    ).toBe(false);
  });
});
