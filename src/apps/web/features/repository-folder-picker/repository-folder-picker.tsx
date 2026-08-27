import type { EnvironmentDirectory } from "@rebase/contracts";
import { IconArrowUp, IconSearch, IconX } from "@tabler/icons-react";
import {
  type JSX,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { EnvironmentFilesystemRejected } from "#web/features/environment-filesystem/environment-filesystem-client.contract";
import {
  keyboardShortcutAria,
  keyboardShortcutLabel,
  keyboardShortcutTitle,
  matchesKeyboardShortcut,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type { RepositoryFolderPickerProps } from "#web/features/repository-folder-picker/repository-folder-picker.contract";
import {
  filterDirectoryEntries,
  repositorySelectionError,
} from "#web/features/repository-folder-picker/repository-folder-picker-state";
import { Button } from "#web-ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "#web-ui/components/ui/dialog";
import { Input } from "#web-ui/components/ui/input";
import { useKeyboardShortcuts } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";
import { RepositoryDirectoryList } from "#web-ui/features/repository-folder-picker/repository-directory-list";
import { RepositoryFolderPickerEnvironmentSelect } from "#web-ui/features/repository-folder-picker/repository-folder-picker-environment-select";

export function RepositoryFolderPicker({
  environments,
  listDirectory,
  onOpenChange,
  onOpenRepository,
  open,
}: RepositoryFolderPickerProps): JSX.Element | null {
  const { bindings, platform } = useKeyboardShortcuts();
  const [environmentId, setEnvironmentId] = useState<string>();
  const [directory, setDirectory] = useState<EnvironmentDirectory>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [directoryError, setDirectoryError] = useState<string>();
  const [selectionError, setSelectionError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const requestId = useRef(0);
  const wasOpen = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadDirectory = useCallback(
    async (
      selectedEnvironmentId: string,
      path?: string,
      selectCurrent = false,
    ) => {
      const currentRequest = ++requestId.current;
      setLoading(true);
      setDirectoryError(undefined);
      setSelectionError(undefined);
      try {
        const listing = await listDirectory(selectedEnvironmentId, path);
        if (currentRequest !== requestId.current) return;
        setDirectory(listing);
        setSelectedPath(selectCurrent ? listing.path : undefined);
      } catch (error) {
        if (currentRequest !== requestId.current) return;
        setDirectory(undefined);
        setSelectedPath(undefined);
        setDirectoryError(directoryListingError(error));
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [listDirectory],
  );

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) requestId.current += 1;
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    const selectedEnvironment =
      environments.find(
        (environment) =>
          environment.id === environmentId &&
          environment.availability === "available",
      ) ??
      environments.find(
        (environment) => environment.availability === "available",
      ) ??
      environments[0];
    if (selectedEnvironment === undefined) return;
    setEnvironmentId(selectedEnvironment.id);
    setSearching(false);
    setQuery("");
    void loadDirectory(selectedEnvironment.id);
  }, [environmentId, environments, loadDirectory, open]);

  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  const selectedEnvironment =
    environments.find((environment) => environment.id === environmentId) ??
    environments[0];
  if (selectedEnvironment === undefined) return null;

  const chooseEnvironment = (nextEnvironmentId: string) => {
    if (nextEnvironmentId === environmentId) return;
    const nextEnvironment = environments.find(
      (environment) => environment.id === nextEnvironmentId,
    );
    if (nextEnvironment === undefined) return;
    setEnvironmentId(nextEnvironmentId);
    setDirectory(undefined);
    setSelectedPath(undefined);
    setQuery("");
    setSelectionError(undefined);
    if (nextEnvironment.availability === "available") {
      void loadDirectory(nextEnvironmentId);
    } else {
      requestId.current += 1;
      setLoading(false);
      setDirectoryError(nextEnvironment.status);
    }
  };

  const navigate = (path: string) => {
    setQuery("");
    void loadDirectory(selectedEnvironment.id, path, true);
  };

  const openRepository = async () => {
    if (selectedPath === undefined || opening) return;
    setOpening(true);
    setSelectionError(undefined);
    try {
      await onOpenRepository(selectedEnvironment.id, selectedPath);
      onOpenChange(false);
    } catch (error) {
      setSelectionError(repositorySelectionError(error));
    } finally {
      setOpening(false);
    }
  };

  const handlePickerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;

    if (matchesKeyboardShortcut(event, bindings["search.focus"], platform)) {
      event.preventDefault();
      setSearching(true);
      searchRef.current?.select();
      return;
    }
    if (
      matchesKeyboardShortcut(
        event,
        bindings["projects.closeActiveRepository"],
        platform,
      )
    ) {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (event.altKey && event.key === "ArrowUp") {
      if (directory?.parentPath === undefined || loading) return;
      event.preventDefault();
      navigate(directory.parentPath);
      return;
    }
    if (
      matchesKeyboardShortcut(
        event,
        bindings["repositoryPicker.openSelectedRepository"],
        platform,
      )
    ) {
      if (selectedPath === undefined || opening || loading) return;
      event.preventDefault();
      void openRepository();
      return;
    }
  };

  const closeShortcut = bindings["projects.closeActiveRepository"];
  const focusSearchShortcut = bindings["search.focus"];
  const openRepositoryShortcut =
    bindings["repositoryPicker.openSelectedRepository"];
  const closeShortcutAria = keyboardShortcutAria(closeShortcut, platform);
  const closeShortcutLabel = keyboardShortcutLabel(closeShortcut, platform);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[min(32rem,calc(100svh-2rem))] max-w-[46rem] flex-col overflow-hidden"
        onKeyDown={handlePickerKeyDown}
      >
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border pr-3 pl-[1.1rem]">
          <DialogTitle className="min-w-0 flex-1 text-base font-semibold">
            Choose repository
          </DialogTitle>
          <DialogDescription className="sr-only">
            Browse folders on an Environment and select a Git repository.
          </DialogDescription>
          <RepositoryFolderPickerEnvironmentSelect
            environments={environments}
            onSelect={chooseEnvironment}
            selected={selectedEnvironment}
          />
          <DialogClose
            aria-label="Close"
            aria-keyshortcuts={
              closeShortcutAria === undefined
                ? "Escape"
                : `Escape ${closeShortcutAria}`
            }
            className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            title={keyboardShortcutTitle("Close", closeShortcut, platform)}
          >
            <IconX aria-hidden="true" className="size-4" />
          </DialogClose>
        </header>

        <div className="grid min-h-[3.25rem] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-3 py-2">
          <Button
            aria-label="Parent directory"
            aria-keyshortcuts="Alt+ArrowUp"
            disabled={directory?.parentPath === undefined || loading}
            onClick={() => {
              if (directory?.parentPath !== undefined) {
                navigate(directory.parentPath);
              }
            }}
            size="icon-sm"
            type="button"
            title="Parent directory (Alt+↑)"
            variant="ghost"
          >
            <IconArrowUp aria-hidden="true" />
          </Button>
          {searching ? (
            <Input
              aria-label="Filter current directory"
              aria-keyshortcuts={keyboardShortcutAria(
                focusSearchShortcut,
                platform,
              )}
              className="h-8 bg-white/[.03] sm:h-8"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter current directory"
              ref={searchRef}
              value={query}
            />
          ) : (
            <nav
              aria-label="Current directory"
              className="flex min-w-0 items-center gap-1 overflow-x-auto text-xs whitespace-nowrap text-muted-foreground"
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
          <Button
            aria-label={
              searching ? "Close directory filter" : "Filter current directory"
            }
            aria-keyshortcuts={keyboardShortcutAria(
              focusSearchShortcut,
              platform,
            )}
            onClick={() => {
              setSearching((current) => !current);
              if (searching) setQuery("");
            }}
            size="icon-sm"
            title={keyboardShortcutTitle(
              "Filter current directory",
              focusSearchShortcut,
              platform,
            )}
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
          error={directoryError}
          loading={loading}
          onEnter={navigate}
          onParent={() => {
            if (directory?.parentPath !== undefined) {
              navigate(directory.parentPath);
            }
          }}
          onSelect={(path) => {
            setSelectedPath(path);
            setSelectionError(undefined);
          }}
          selectedPath={selectedPath}
          truncated={directory?.truncated ?? false}
        />

        <footer className="grid min-h-[3.75rem] shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-border px-3 py-2 max-[540px]:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="truncate font-mono text-[.69rem] text-muted-foreground">
              {selectedPath ?? "Select a folder"}
            </p>
            {selectionError !== undefined ? (
              <p
                aria-live="polite"
                className="truncate text-[.68rem] text-destructive"
              >
                {selectionError}
              </p>
            ) : null}
          </div>
          <DialogClose
            aria-keyshortcuts={
              closeShortcutAria === undefined
                ? "Escape"
                : `Escape ${closeShortcutAria}`
            }
            className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-white/[.03] px-3 text-xs font-medium text-foreground/80 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 max-[540px]:hidden"
            title={`Cancel (Esc${closeShortcutLabel.length === 0 ? "" : `, ${closeShortcutLabel}`})`}
          >
            Cancel
          </DialogClose>
          <Button
            aria-keyshortcuts={keyboardShortcutAria(
              openRepositoryShortcut,
              platform,
            )}
            className="h-8 px-3 text-xs sm:h-8"
            disabled={selectedPath === undefined || opening || loading}
            onClick={() => void openRepository()}
            type="button"
            title={keyboardShortcutTitle(
              "Open repository",
              openRepositoryShortcut,
              platform,
            )}
          >
            {opening ? "Opening…" : "Open repository"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function directoryListingError(error: unknown) {
  if (
    error instanceof EnvironmentFilesystemRejected &&
    error.failure._tag === "EnvironmentDirectoryRejected"
  ) {
    switch (error.failure.reason) {
      case "NotFound":
        return "This folder no longer exists.";
      case "NotDirectory":
        return "This path is not a folder.";
      case "PermissionDenied":
        return "Rebase does not have permission to open this folder.";
      case "MalformedPath":
        return "This folder path is invalid.";
      case "InspectionFailed":
        return "Rebase could not read this folder.";
    }
  }
  return "The Environment filesystem is unavailable.";
}
