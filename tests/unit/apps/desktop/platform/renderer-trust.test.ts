import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vite-plus/test";
import { createTrustedIpcHandler } from "#desktop/platform/renderer-trust/renderer-trust";

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

function invokeEvent(url: string, senderFrame?: { readonly url: string }) {
  const mainFrame = { url };
  return {
    sender: { mainFrame },
    senderFrame: senderFrame ?? mainFrame,
  } as unknown as IpcMainInvokeEvent;
}
