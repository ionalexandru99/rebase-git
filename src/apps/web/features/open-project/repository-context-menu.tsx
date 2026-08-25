import {
  IconCopy,
  IconDots,
  IconExternalLink,
  IconMinus,
} from "@tabler/icons-react";
import { type JSX, useState } from "react";
import type { OpenProjectRepository } from "#web/features/open-project/open-project.contract";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "#web-ui/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#web-ui/components/ui/dropdown-menu";

export function RepositoryContextMenu({
  available,
  onCopyPath,
  onRemove,
  onReveal,
  repository,
  revealAvailable,
}: {
  readonly available: boolean;
  readonly onCopyPath: (repository: OpenProjectRepository) => void;
  readonly onRemove: (repository: OpenProjectRepository) => void;
  readonly onReveal: (repository: OpenProjectRepository) => void;
  readonly repository: OpenProjectRepository;
  readonly revealAvailable: boolean;
}): JSX.Element {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Repository actions for ${repository.name}`}
          className="grid size-7 place-items-center rounded-[.4rem] text-muted-foreground opacity-0 outline-none hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/30 group-hover:opacity-100 aria-expanded:opacity-100"
        >
          <IconDots aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            disabled={!available || !revealAvailable}
            onClick={() => onReveal(repository)}
          >
            <IconExternalLink aria-hidden="true" />
            Reveal in file manager
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCopyPath(repository)}>
            <IconCopy aria-hidden="true" />
            Copy path
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-status-unavailable data-highlighted:text-status-unavailable"
            onClick={() => setConfirmingRemoval(true)}
          >
            <IconMinus aria-hidden="true" />
            Remove repository
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog onOpenChange={setConfirmingRemoval} open={confirmingRemoval}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove repository?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove {repository.name} from Rebase? The repository and its files
            will stay on disk.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onRemove(repository)}>
              Remove repository
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
