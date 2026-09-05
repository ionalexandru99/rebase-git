export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard
      .writeText(text)
      .catch(() => writeLegacyClipboardText(text));
    return;
  }
  writeLegacyClipboardText(text);
}

function writeLegacyClipboardText(text: string) {
  const active = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;
  field.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    field.remove();
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
  }
}
