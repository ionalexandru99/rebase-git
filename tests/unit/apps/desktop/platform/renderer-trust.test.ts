import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createTrustedIpcHandler,
  isExternalPullRequestLink,
} from "#desktop/platform/renderer-trust.ts";

const { fromWebContents } = vi.hoisted(() => ({ fromWebContents: vi.fn() }));

vi.mock("electron", () => ({ BrowserWindow: { fromWebContents } }));

const rendererUrl = "file:///app/web/index.html";

describe("trusted IPC handler", () => {
  const trusted = createTrustedIpcHandler({
    type: "file",
    path: "/app/web/index.html",
  });
  const handler = trusted((_event, value: string) => `handled ${value}`);

  it("runs the handler for the main frame of a live window at the renderer location", () => {
    fromWebContents.mockReturnValue({ isDestroyed: () => false });

    expect(handler(invokeEvent(rendererUrl), "x")).toBe("handled x");
  });

  it("rejects a frame that is not the sender's main frame", () => {
    fromWebContents.mockReturnValue({ isDestroyed: () => false });

    expect(() =>
      handler(invokeEvent(rendererUrl, { url: rendererUrl }), "x"),
    ).toThrow("main Rebase window");
  });

  it("rejects a main frame that left the renderer location", () => {
    fromWebContents.mockReturnValue({ isDestroyed: () => false });

    expect(() => handler(invokeEvent("https://evil.example/"), "x")).toThrow(
      "main Rebase window",
    );
  });
});

describe("external links", () => {
  it("opens only https GitHub, Azure DevOps, GitLab and Forgejo pull request links in the system browser", () => {
    expect(
      isExternalPullRequestLink("https://github.com/octo/rebase/pull/7"),
    ).toBe(true);
    expect(
      isExternalPullRequestLink("http://github.com/octo/rebase/pull/7"),
    ).toBe(false);
    expect(isExternalPullRequestLink("https://github.com.evil.example/")).toBe(
      false,
    );
    expect(
      isExternalPullRequestLink(
        "https://dev.azure.com/acme/rebase/_git/rebase/pullrequest/7",
      ),
    ).toBe(true);
    expect(
      isExternalPullRequestLink(
        "https://git.example.com/group/sub/rebase/-/merge_requests/7",
      ),
    ).toBe(true);
    expect(
      isExternalPullRequestLink("https://codeberg.org/forge/rebase/pulls/7"),
    ).toBe(true);
    expect(
      isExternalPullRequestLink("https://git.example.com/group/rebase"),
    ).toBe(false);
    expect(isExternalPullRequestLink("file:///etc/passwd")).toBe(false);
  });
});

function invokeEvent(url: string, senderFrame?: { readonly url: string }) {
  const mainFrame = { url };
  return {
    sender: { mainFrame },
    senderFrame: senderFrame ?? mainFrame,
  } as unknown as IpcMainInvokeEvent;
}
