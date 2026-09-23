import type { IpcMainInvokeEvent } from "electron";

export type TrustedIpcHandler = <Arguments extends readonly unknown[], Result>(
  handler: (event: IpcMainInvokeEvent, ...arguments_: Arguments) => Result,
) => (event: IpcMainInvokeEvent, ...arguments_: Arguments) => Result;
