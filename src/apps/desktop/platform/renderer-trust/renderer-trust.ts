import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { DesktopRenderer } from "#desktop/app/desktop-application.contract";
import type { TrustedIpcHandler } from "#desktop/platform/renderer-trust/renderer-trust.contract";

export function isTrustedRendererLocation(
  renderer: DesktopRenderer,
  target: string,
) {
  const targetUrl = new URL(target);
  if (renderer.type === "url") {
    return targetUrl.origin === new URL(renderer.url).origin;
  }
  return (
    targetUrl.protocol === "file:" &&
    fileURLToPath(targetUrl) === resolve(renderer.path)
  );
}

export function createTrustedIpcHandler(
  renderer: DesktopRenderer,
): TrustedIpcHandler {
  return (handler) =>
    (event, ...arguments_) => {
      if (!isTrustedSender(event, renderer)) {
        throw new Error("Desktop commands require the main Rebase window.");
      }
      return handler(event, ...arguments_);
    };
}

function isTrustedSender(event: IpcMainInvokeEvent, renderer: DesktopRenderer) {
  const window = BrowserWindow.fromWebContents(event.sender);
  const frame = event.senderFrame;
  return (
    window !== null &&
    !window.isDestroyed() &&
    frame !== null &&
    frame === event.sender.mainFrame &&
    isTrustedRendererLocation(renderer, frame.url)
  );
}
