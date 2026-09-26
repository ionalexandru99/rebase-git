import type { ChangeSection, ChangeSelection } from "@rebase/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "#web-ui/components/ui/alert-dialog";

export interface DiscardRequest {
  readonly section: ChangeSection;
  readonly selection: ChangeSelection;
  readonly revision: string;
}

export function DiscardConfirmation({
  request,
  confirm,
  close,
}: {
  readonly request: DiscardRequest | null;
  readonly confirm: (request: DiscardRequest) => void;
  readonly close: () => void;
}) {
  return (
    <AlertDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>Discard {request?.section} changes?</AlertDialogTitle>
        <AlertDialogDescription>
          {describeDiscard(request?.selection)} This cannot be undone. Unrelated
          edits will be preserved; overlapping edits will stop the operation.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (request) confirm(request);
              close();
            }}
          >
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function describeDiscard(selection: ChangeSelection | undefined) {
  if (selection?._tag === "Lines")
    return `Discard ${selection.lines.length} selected changed lines in ${selection.path}.`;
  if (selection?._tag === "Files")
    return `Discard changes in ${selection.paths.length} selected ${selection.paths.length === 1 ? "file" : "files"}.`;
  return "Discard every change in this section, including files hidden by the filter.";
}
