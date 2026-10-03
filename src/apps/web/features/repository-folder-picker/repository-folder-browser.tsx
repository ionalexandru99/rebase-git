import {
  IconArrowUp,
  IconFolderPlus,
  IconGitBranch,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
  type FolderAction,
  type FolderPickerPurpose,
  useFolderBrowser,
} from "#web/features/repository-folder-picker/hooks/use-folder-browser.ts";
import { RepositoryDirectoryList } from "#web/features/repository-folder-picker/repository-directory-list.tsx";
import {
  type RepositoryFolderPickerEnvironment,
  RepositoryFolderPickerEnvironmentSelect,
} from "#web/features/repository-folder-picker/repository-folder-picker-environment-select.tsx";
import { filterDirectoryEntries } from "#web/features/repository-folder-picker/repository-folder-picker-state.ts";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";

const actionLabels: Record<FolderAction, string> = {
  Open: "Open repository",
  Initialize: "Initialize repository",
  Choose: "Choose folder",
};

const runningLabels: Record<FolderAction, string> = {
  Open: "Opening…",
  Initialize: "Initializing…",
  Choose: "Choose folder",
};

export function RepositoryFolderBrowser({
  title,
  environment,
  environmentSelect,
  purpose,
}: {
  readonly title: string;
  readonly environment: {
    readonly available: boolean;
    readonly status: string;
  };
  readonly environmentSelect?: ReactNode;
  readonly purpose: FolderPickerPurpose;
}): JSX.Element {
  const browser = useFolderBrowser(environment, purpose);
  const { directory, loading } = browser;
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);
  const navigate = (path: string) => {
    setQuery("");
    browser.navigate(path);
  };
  const openParent = () => {
    if (directory?.parentPath !== undefined) navigate(directory.parentPath);
  };

  return (
    <>
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border pr-3 pl-[1.1rem]">
        <DialogTitle className="min-w-0 flex-1 text-base font-semibold">
          {title}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Browse folders on an Environment.
        </DialogDescription>
        {environmentSelect}
        <DialogClose
          aria-label="Close"
          className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <IconX aria-hidden="true" className="size-4" />
        </DialogClose>
      </header>

      <div className="flex min-h-[3.25rem] shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button
          aria-label="Parent directory"
          disabled={directory?.parentPath === undefined || loading}
          onClick={openParent}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <IconArrowUp aria-hidden="true" />
        </Button>
        {searching ? (
          <Input
            aria-label="Filter current directory"
            className="h-8 min-w-0 flex-1 bg-white/[.03] sm:h-8"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter current directory"
            ref={searchRef}
            value={query}
          />
        ) : (
          <nav
            aria-label="Current directory"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs whitespace-nowrap text-muted-foreground"
          >
            {directory?.breadcrumbs.map((breadcrumb, index) => (
              <span className="flex items-center gap-1" key={breadcrumb.path}>
                {index > 0 ? (
                  <span aria-hidden="true" className="text-foreground/25">
                    /
                  </span>
                ) : null}
                <button
                  className="rounded-sm px-1.5 py-1 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:bg-accent disabled:text-foreground"
                  disabled={breadcrumb.path === directory.path || loading}
                  onClick={() => navigate(breadcrumb.path)}
                  type="button"
                >
                  {breadcrumb.name}
                </button>
              </span>
            ))}
          </nav>
        )}
        {purpose._tag === "Open" ? (
          <Button
            className="text-xs"
            disabled={
              directory === undefined ||
              directory.repository ||
              browser.newFolder !== undefined
            }
            onClick={() => browser.nameNewFolder("")}
            size="sm"
            type="button"
            variant="ghost"
          >
            <IconFolderPlus aria-hidden="true" />
            New folder
          </Button>
        ) : null}
        <Button
          aria-label={
            searching ? "Close directory filter" : "Filter current directory"
          }
          onClick={() => {
            setSearching((current) => !current);
            if (searching) setQuery("");
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {searching ? (
            <IconX aria-hidden="true" />
          ) : (
            <IconSearch aria-hidden="true" />
          )}
        </Button>
      </div>

      <RepositoryDirectoryList
        entries={filterDirectoryEntries(directory?.entries ?? [], query)}
        error={browser.directoryError}
        loading={loading}
        newFolder={browser.newFolder}
        onCancelNewFolder={browser.cancelNewFolder}
        onEnter={navigate}
        onNameNewFolder={browser.nameNewFolder}
        onParent={openParent}
        onSelect={browser.select}
        onSubmitNewFolder={() => void browser.run()}
        selectedPath={browser.selectedPath}
        truncated={directory?.truncated ?? false}
      />

      <footer className="flex min-h-[3.75rem] shrink-0 items-center gap-2 border-t border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[.69rem] text-muted-foreground">
            {browser.selectedPath ?? "Select a folder"}
          </p>
          {browser.selectionError !== undefined ? (
            <p
              aria-live="polite"
              className="text-[.68rem] whitespace-pre-line text-destructive"
            >
              {browser.selectionError}
            </p>
          ) : null}
        </div>
        {browser.action === "Initialize" ? (
          <div className="relative w-32 shrink-0">
            <IconGitBranch
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Initial branch"
              className="h-8 bg-white/[.03] pl-8 text-xs sm:h-8 sm:text-xs"
              onChange={(event) => browser.setBranch(event.target.value)}
              value={browser.branch}
            />
          </div>
        ) : null}
        <DialogClose className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-white/[.03] px-3 text-xs font-medium text-foreground/80 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 max-[540px]:hidden">
          Cancel
        </DialogClose>
        <Button
          className="h-8 px-3 text-xs sm:h-8"
          disabled={
            browser.selectedPath === undefined ||
            browser.running ||
            loading ||
            (browser.action === "Initialize" && browser.branch.trim() === "")
          }
          onClick={() => void browser.run()}
          type="button"
        >
          {browser.running
            ? runningLabels[browser.action]
            : actionLabels[browser.action]}
        </Button>
      </footer>
    </>
  );
}

export function RepositoryFolderPicker({
  environments,
  onOpenChange,
  onRepositoryOpened,
  open,
}: {
  readonly environments: readonly RepositoryFolderPickerEnvironment[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onRepositoryOpened: (
    environmentId: string,
    repository: RepositoryCatalogEntry,
  ) => void;
  readonly open: boolean;
}): JSX.Element | null {
  const [environmentId, setEnvironmentId] = useState<string>();
  const environment =
    environments.find(({ id }) => id === environmentId) ??
    environments.find(({ availability }) => availability === "available") ??
    environments[0];
  if (environment === undefined) return null;
  return (
    <FolderDialog onOpenChange={onOpenChange} open={open}>
      <RepositoryFolderBrowser
        key={environment.id}
        environment={{
          available: environment.availability === "available",
          status: environment.status,
        }}
        environmentSelect={
          <RepositoryFolderPickerEnvironmentSelect
            environments={environments}
            onSelect={setEnvironmentId}
            selected={environment}
          />
        }
        purpose={{
          _tag: "Open",
          onRepositoryOpened: (repository) => {
            onRepositoryOpened(environment.id, repository);
            onOpenChange(false);
          },
        }}
        title="Choose repository"
      />
    </FolderDialog>
  );
}

export function FolderPicker({
  title,
  onChosen,
  onOpenChange,
  open,
}: {
  readonly title: string;
  readonly onChosen: (path: string) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}): JSX.Element {
  const { availability, status } = useEnvironment().status;
  return (
    <FolderDialog onOpenChange={onOpenChange} open={open}>
      <RepositoryFolderBrowser
        environment={{ available: availability === "available", status }}
        purpose={{
          _tag: "Choose",
          onChosen: (path) => {
            onChosen(path);
            onOpenChange(false);
          },
        }}
        title={title}
      />
    </FolderDialog>
  );
}

function FolderDialog({
  children,
  onOpenChange,
  open,
}: {
  readonly children: ReactNode;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[min(32rem,calc(100svh-2rem))] max-w-[46rem] flex-col overflow-hidden">
        {children}
      </DialogContent>
    </Dialog>
  );
}
