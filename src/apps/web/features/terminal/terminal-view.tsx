import "@xterm/xterm/css/xterm.css";
import "#web/features/terminal/terminal.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import {
  type TerminalSize,
  TerminalsApi,
  terminalWriteLimit,
} from "#contracts/terminal/terminal.contract.ts";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";
import { createStore } from "#web/platform/store/store.ts";
import { useStore } from "#web/platform/store/use-store.ts";

const fontFamily =
  '"JetBrains Mono", "SF Mono", SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", "Symbols Nerd Font Mono", monospace';

const defaultFontSize = 12;
const fontSizeKey = "rebase:terminal-font-size:v1";
const fontSizeStore = createStore(readFontSize());

interface Surface {
  readonly xterm: Terminal;
  readonly fit: FitAddon;
}

export function isTerminalShortcut(event: KeyboardEvent) {
  return (
    event.code === "Backquote" &&
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  );
}

function zoomStep(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return undefined;
  if (event.key === "=" || event.key === "+") return 1;
  if (event.key === "-") return -1;
  if (event.key === "0") return 0;
  return undefined;
}

function zoom(event: KeyboardEvent) {
  const step = zoomStep(event);
  if (step === undefined) return false;
  event.preventDefault();
  if (event.type !== "keydown") return true;
  const size =
    step === 0
      ? defaultFontSize
      : Math.min(32, Math.max(6, fontSizeStore.getSnapshot() + step));
  fontSizeStore.set(size);
  try {
    localStorage.setItem(fontSizeKey, String(size));
  } catch {}
  return true;
}

function readFontSize() {
  try {
    const size = Number(localStorage.getItem(fontSizeKey));
    return Number.isInteger(size) && size >= 6 && size <= 32
      ? size
      : defaultFontSize;
  } catch {
    return defaultFontSize;
  }
}

export function TerminalView({
  id,
  visible,
  focus,
}: {
  readonly id: string;
  readonly visible: boolean;
  readonly focus: number;
}) {
  const { requests, subscribe, connected } = useEnvironment();
  const host = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const [surface, setSurface] = useState<Surface>();
  const fontSize = useStore(fontSizeStore);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const style = getComputedStyle(element);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const xterm = new Terminal({
      fontFamily,
      fontSize: fontSizeStore.getSnapshot(),
      lineHeight: 1.25,
      cursorBlink: false,
      scrollback: 5_000,
      theme: {
        background: color("--repository"),
        foreground: color("--foreground"),
        cursor: color("--foreground"),
        selectionBackground: color("--accent"),
      },
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.attachCustomKeyEventHandler(
      (event) => !isTerminalShortcut(event) && !zoom(event),
    );
    xterm.open(element);
    setSurface({ xterm, fit });
    return () => xterm.dispose();
  }, []);

  useEffect(() => {
    if (surface === undefined) return;
    const write = sendInOrder((data) =>
      requests(TerminalsApi.write, { id, data }),
    );
    const input = surface.xterm.onData(write);
    return () => input.dispose();
  }, [surface, requests, id]);

  useEffect(() => {
    if (surface === undefined || !connected) return;
    const controller = new AbortController();
    subscribe(
      TerminalsApi.attach,
      { id, since: offset.current },
      (output) => {
        if (output._tag === "Exited") return;
        if (output._tag === "Reset") surface.xterm.reset();
        surface.xterm.write(output.data);
        offset.current = output.end;
      },
      controller.signal,
    ).catch(() => {});
    return () => controller.abort();
  }, [surface, connected, subscribe, id]);

  useEffect(() => {
    const element = host.current;
    if (surface === undefined || element === null || !visible) return;
    surface.xterm.options.fontSize = fontSize;
    const resize = sendLatest((size: TerminalSize) =>
      requests(TerminalsApi.resize, { id, ...size }),
    );
    let sent = "";
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      surface.fit.fit();
      const size = { cols: surface.xterm.cols, rows: surface.xterm.rows };
      if (`${size.cols}x${size.rows}` === sent) return;
      sent = `${size.cols}x${size.rows}`;
      resize(size);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [surface, visible, fontSize, requests, id]);

  useEffect(() => {
    if (surface !== undefined && visible && focus > 0) surface.xterm.focus();
  }, [surface, visible, focus]);

  return <div ref={host} className="h-full w-full" />;
}

function sendInOrder(send: (data: string) => Promise<unknown>) {
  let pending = "";
  let sending = false;
  const drain = () => {
    if (sending || pending === "") return;
    const data = pending.slice(0, terminalWriteLimit);
    pending = pending.slice(data.length);
    sending = true;
    void send(data)
      .catch(() => {})
      .finally(() => {
        sending = false;
        drain();
      });
  };
  return (data: string) => {
    pending += data;
    drain();
  };
}

function sendLatest<Value>(send: (value: Value) => Promise<unknown>) {
  let next: Value | undefined;
  let sending = false;
  const drain = () => {
    if (sending || next === undefined) return;
    const value = next;
    next = undefined;
    sending = true;
    void send(value)
      .catch(() => {})
      .finally(() => {
        sending = false;
        drain();
      });
  };
  return (value: Value) => {
    next = value;
    drain();
  };
}
