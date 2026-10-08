type DesktopSystem = "mac" | "windows" | "linux";

const systemNames: Record<DesktopSystem, string> = {
  mac: "macOS",
  windows: "Windows",
  linux: "Linux",
};

function detectSystem(): DesktopSystem | null {
  const agent = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|CrOS/.test(agent)) {
    return null;
  }
  if (agent.includes("Macintosh")) {
    return navigator.maxTouchPoints > 1 ? null : "mac";
  }
  if (agent.includes("Windows")) {
    return "windows";
  }
  if (agent.includes("Linux")) {
    return "linux";
  }
  return null;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing ${selector}`);
  }
  return element;
}

function startDownload() {
  const download = required<HTMLElement>("[data-download]");
  const link = required<HTMLAnchorElement>("[data-download-link]");
  const label = required<HTMLElement>("[data-download-label]");
  const toggle = required<HTMLButtonElement>("[data-download-toggle]");
  const menu = required<HTMLElement>("#download-menu");
  const items = [
    ...menu.querySelectorAll<HTMLAnchorElement>("[role=menuitem]"),
  ];

  const system = detectSystem();
  const current =
    system === null
      ? undefined
      : items.find((item) => item.dataset.system === system);
  if (system === null || current === undefined) {
    download.hidden = true;
    required<HTMLElement>("[data-download-elsewhere]").hidden = false;
    return;
  }
  link.href = current.href;
  label.textContent = `Download for ${systemNames[system]}`;
  current.dataset.current = "";
  toggle.hidden = false;

  const open = (index: number) => {
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    items.at(index)?.focus();
  };
  const close = (returnFocus: boolean) => {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (returnFocus) {
      toggle.focus();
    }
  };
  const focused = () =>
    items.findIndex((item) => item === document.activeElement);

  toggle.addEventListener("click", () => {
    if (menu.hidden) {
      open(0);
    } else {
      close(false);
    }
  });
  toggle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open(event.key === "ArrowDown" ? 0 : -1);
    }
  });
  menu.addEventListener("keydown", (event) => {
    const moves: Record<string, number> = {
      ArrowDown: (focused() + 1) % items.length,
      ArrowUp: (focused() - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    const target = moves[event.key];
    if (target !== undefined) {
      event.preventDefault();
      items[target]?.focus();
    } else if (event.key === "Escape") {
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  });
  menu.addEventListener("click", () => close(false));
  document.addEventListener("pointerdown", (event) => {
    if (!menu.hidden && !download.contains(event.target as Node)) {
      close(false);
    }
  });
}

function startCopy() {
  const button = required<HTMLButtonElement>("[data-copy]");
  const text = required<HTMLElement>("[data-copy-text]");
  const label = button.getAttribute("aria-label") ?? "";
  const reset = () => {
    delete button.dataset.copied;
    button.setAttribute("aria-label", label);
  };
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text.textContent ?? "");
      button.dataset.copied = "";
      button.setAttribute("aria-label", "Copied");
    } catch {
      getSelection()?.selectAllChildren(text);
    }
  });
  button.addEventListener("pointerleave", reset);
  button.addEventListener("blur", reset);
}

startDownload();
startCopy();
