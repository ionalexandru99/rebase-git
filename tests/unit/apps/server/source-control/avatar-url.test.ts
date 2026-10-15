import { describe, expect, it } from "vite-plus/test";
import { avatarUrl } from "#server/features/source-control/git-host.ts";

describe("avatar url", () => {
  it("accepts the host's own https images at the requested size", () => {
    expect(
      avatarUrl("https://secure.gravatar.com/avatar/a?s=80", ["gravatar.com"], {
        s: "40",
      }),
    ).toBe("https://secure.gravatar.com/avatar/a?s=40");
  });

  it.each([
    "http://gravatar.com/avatar/a",
    "https://127.0.0.1/avatar/a",
    "https://gravatar.com.example.test/avatar/a",
    "https://user:secret@gravatar.com/avatar/a",
    "not a url",
  ])("refuses %s", (url) => {
    expect(avatarUrl(url, ["gravatar.com"])).toBeUndefined();
  });
});
