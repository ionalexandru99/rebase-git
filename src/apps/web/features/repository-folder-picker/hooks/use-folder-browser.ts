import { useState } from "react";
import { EnvironmentFilesystemApi } from "#contracts/environment-filesystem/environment-filesystem.contract.ts";
import {
  RepositoryCatalogApi,
  type RepositoryCatalogEntry,
} from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { notCreatedMessage } from "#web/features/repository-catalog/repository-not-created.ts";
import { catalogWith } from "#web/features/repository-catalog/use-repository-catalog.ts";
import {
  childPath,
  directoryListingError,
  repositorySelectionError,
} from "#web/features/repository-folder-picker/repository-folder-picker-state.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

export type FolderPickerPurpose =
  | {
      readonly _tag: "Open";
      readonly onRepositoryOpened: (repository: RepositoryCatalogEntry) => void;
    }
  | {
      readonly _tag: "Choose";
      readonly onChosen: (path: string) => void;
    };

export type FolderAction = "Open" | "Initialize" | "Choose";

type FolderSelection =
  | { readonly _tag: "None" }
  | { readonly _tag: "Current" }
  | { readonly _tag: "Folder"; readonly path: string }
  | { readonly _tag: "NewFolder"; readonly name: string };

const nothingSelected: FolderSelection = { _tag: "None" };

export function useFolderBrowser(
  environment: { readonly available: boolean; readonly status: string },
  purpose: FolderPickerPurpose,
) {
  const [location, setLocation] = useState<string>();
  const [selection, setSelection] = useState<FolderSelection>(nothingSelected);
  const [branch, setBranch] = useState<string>();
  const listing = useDirectoryListing(location, environment.available);
  const defaults = useEnvironmentQuery(
    RepositoryCatalogApi.defaults,
    undefined,
    {
      enabled: purpose._tag === "Open",
      changes: "none",
    },
  );
  const remember = useCommand(RepositoryCatalogApi.remember, {
    answers: catalogWith,
  });
  const initialize = useCommand(RepositoryCatalogApi.initialize, {
    answers: catalogWith,
  });
  const errorToast = useErrorToast();
  const directory = listing.isError ? undefined : listing.data;
  const selectedPath =
    directory === undefined
      ? undefined
      : selection._tag === "Folder"
        ? selection.path
        : selection._tag === "Current"
          ? directory.path
          : selection._tag === "NewFolder" && selection.name.trim() !== ""
            ? childPath(directory.path, selection.name.trim())
            : undefined;
  const selectedEntry =
    selection._tag === "Folder"
      ? directory?.entries.find((entry) => entry.path === selection.path)
      : undefined;
  const action: FolderAction =
    purpose._tag === "Choose"
      ? "Choose"
      : selection._tag === "NewFolder" ||
          (selectedEntry !== undefined &&
            selectedEntry.kind !== "Repository" &&
            directory?.repository === false)
        ? "Initialize"
        : "Open";
  const initialBranch = branch ?? defaults.data?.initialBranch ?? "main";

  const reset = () => {
    remember.reset();
    initialize.reset();
  };
  const navigate = (path: string) => {
    reset();
    setLocation(path);
    setSelection({ _tag: "Current" });
  };

  const run = async () => {
    if (selectedPath === undefined || remember.running || initialize.running)
      return;
    if (purpose._tag === "Choose") {
      purpose.onChosen(selectedPath);
      return;
    }
    if (action === "Initialize") {
      if (initialBranch.trim() === "") return;
      const result = await initialize.run({
        path: selectedPath,
        branch: initialBranch.trim(),
      });
      if (result._tag === "Ok") purpose.onRepositoryOpened(result.value);
      else if (notCreatedMessage(result) === undefined)
        errorToast.failure("openRepository", result);
      return;
    }
    const result = await remember.run({ path: selectedPath });
    if (result._tag === "Ok") purpose.onRepositoryOpened(result.value);
    else if (repositorySelectionError(result) === undefined)
      errorToast.failure("openRepository", result);
  };

  return {
    action,
    branch: initialBranch,
    directory,
    newFolder: selection._tag === "NewFolder" ? selection.name : undefined,
    selectedPath,
    loading: environment.available && listing.isLoading,
    running: remember.running || initialize.running,
    directoryError: !environment.available
      ? environment.status
      : listing.isError
        ? directoryListingError(listing.error)
        : undefined,
    selectionError:
      remember.failure !== undefined
        ? repositorySelectionError(remember.failure)
        : initialize.failure !== undefined
          ? notCreatedMessage(initialize.failure)
          : undefined,
    navigate,
    select: (path: string) => {
      reset();
      setSelection({ _tag: "Folder", path });
    },
    nameNewFolder: (name: string) => {
      reset();
      setSelection({ _tag: "NewFolder", name });
    },
    cancelNewFolder: () => {
      reset();
      setSelection({ _tag: "Current" });
    },
    setBranch,
    run,
  };
}

function useDirectoryListing(path: string | undefined, enabled: boolean) {
  return useEnvironmentQuery(
    EnvironmentFilesystemApi.listDirectory,
    path === undefined ? {} : { path },
    { enabled, changes: "none", staleTime: 0, refetchOnWindowFocus: false },
  );
}
