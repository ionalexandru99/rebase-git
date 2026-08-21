import { contextBridge } from "electron";
import type { DesktopHostBridge } from "#desktop/desktop-host.contract";

const environmentOriginArgument = "--rebase-environment-origin=";
const environmentOrigin = process.argv
  .find((argument) => argument.startsWith(environmentOriginArgument))
  ?.slice(environmentOriginArgument.length);

if (environmentOrigin === undefined) {
  throw new Error("The Electron host did not provide an Environment origin.");
}

const host = Object.freeze({ environmentOrigin }) satisfies DesktopHostBridge;
contextBridge.exposeInMainWorld("rebaseHost", host);
