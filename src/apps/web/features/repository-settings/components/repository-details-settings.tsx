import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "#web/components/ui/alert-dialog.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { SettingsRow } from "#web/components/ui/settings-layout.tsx";
import {
  type ErrorAction,
  useErrorToast,
} from "#web/features/notifications/notifications.tsx";

export function RepositoryDetailsSettings({
  path,
  connected,
  canRemove,
  copyPath,
  reveal,
  remove,
}: {
  readonly path: string;
  readonly connected: boolean;
  readonly canRemove: boolean;
  readonly copyPath: () => Promise<void>;
  readonly reveal: (() => Promise<void>) | undefined;
  readonly remove: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const errorToast = useErrorToast();
  const run = async (
    action: () => Promise<void>,
    failure: ErrorAction,
    success?: string,
  ) => {
    setPending(true);
    setMessage(undefined);
    try {
      await action();
      setMessage(success);
    } catch {
      errorToast.show(failure);
    }
    setPending(false);
  };
  return (
    <>
      <SettingsRow
        title="Checkout path"
        description={<span className="break-all font-mono">{path}</span>}
      >
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void run(copyPath, "copyPath", "Path copied.")}
        >
          Copy path
        </Button>
        {reveal === undefined ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !connected}
            onClick={() => void run(reveal, "revealRepository")}
          >
            Reveal
          </Button>
        )}
      </SettingsRow>
      <SettingsRow
        title="Remove from Rebase"
        description={
          canRemove
            ? "The repository and its files stay on disk."
            : "Connect with repository catalog access to remove this repository."
        }
      >
        <Button
          size="sm"
          variant="outline"
          className="text-destructive"
          disabled={pending || !canRemove}
          onClick={() => setConfirming(true)}
        >
          Remove repository
        </Button>
      </SettingsRow>
      {message === undefined ? null : (
        <p
          role="status"
          className="px-3 py-3 text-meta text-muted-foreground sm:px-4"
        >
          {message}
        </p>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove repository?</AlertDialogTitle>
          <AlertDialogDescription>
            The repository and its files stay on disk.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void run(remove, "removeRepository")}
            >
              Remove repository
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
