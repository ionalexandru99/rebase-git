import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "#web-ui/components/ui/alert-dialog";
import { Button } from "#web-ui/components/ui/button";
import { SettingsRow } from "#web-ui/features/settings/components/settings-layout";

export function RepositoryDetailsSettings({
  name,
  path,
  connected,
  canRemove,
  copyPath,
  reveal,
  remove,
}: {
  readonly name: string;
  readonly path: string;
  readonly connected: boolean;
  readonly canRemove: boolean;
  readonly copyPath: () => Promise<void>;
  readonly reveal: (() => Promise<void>) | undefined;
  readonly remove: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const run = async (action: () => Promise<void>, success?: string) => {
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await action();
      setMessage(success);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The repository action failed. Try again.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <SettingsRow
        title="Checkout path"
        description={
          <span className="break-all font-mono text-xs">{path}</span>
        }
      >
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void run(copyPath, "Path copied.")}
        >
          Copy path
        </Button>
        {reveal === undefined ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !connected}
            onClick={() => void run(reveal)}
          >
            Reveal
          </Button>
        )}
      </SettingsRow>
      <SettingsRow
        title="Remove from Rebase"
        description={
          canRemove
            ? "Keeps the repository and its files on disk."
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
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove repository?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove {name} from Rebase? The repository and its files will stay on
            disk.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run(remove)}>
              Remove repository
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
