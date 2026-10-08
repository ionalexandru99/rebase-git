import { type Action, submenu } from "#web/components/ui/action-menu.tsx";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text.ts";
import type { ErrorToast } from "#web/features/notifications/notifications.tsx";

export function copyCommitMenu(
  commit: { readonly oid: string; readonly subject: string },
  errorToast: ErrorToast,
): Action {
  const copy = (
    id: "copySha" | "copySubject",
    label: string,
    text: string,
  ): Action => ({
    id,
    label,
    enabled: true,
    run: () => void writeClipboardText(text).catch(() => errorToast.show(id)),
  });
  return submenu({ id: "copy", label: "Copy", group: "edit" }, [
    copy("copySha", "SHA", commit.oid),
    copy("copySubject", "Subject", commit.subject),
  ]);
}
