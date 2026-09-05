import { useEffect } from "react";
import {
  matchesKeyboardShortcut,
  repositorySelectionCommandId,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type { KeyboardShortcutCommandId } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";
import { repositorySelectionPositions } from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";
import type { EnvironmentAvailability } from "#web/features/project-navigation/project-navigation.contract";
import { useKeyboardShortcuts } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";

type ShortcutCommand = readonly [
  commandId: KeyboardShortcutCommandId,
  enabled: boolean,
  action: () => void,
];

export function useApplicationShortcuts({
  availability,
  closeSelectedRepository,
  folderPickerOpen,
  focusBranchesSidebar,
  focusSidebarFilter,
  hasSelectedRepository,
  openFolderPicker,
  openSettings,
  openRepositorySettings,
  repositorySettingsOpen,
  selectNextRepository,
  selectPreviousRepository,
  selectRepositoryByPosition,
  selectableRepositoryCount,
  settingsOpen,
  showOpenProject,
  toggleSidebar,
}: {
  readonly availability: EnvironmentAvailability;
  readonly closeSelectedRepository: () => void;
  readonly folderPickerOpen: boolean;
  readonly focusBranchesSidebar: () => void;
  readonly focusSidebarFilter: () => void;
  readonly hasSelectedRepository: boolean;
  readonly openFolderPicker: () => void;
  readonly openRepositorySettings: () => void;
  readonly repositorySettingsOpen: boolean;
  readonly openSettings: (open: boolean) => void;
  readonly selectNextRepository: () => void;
  readonly selectPreviousRepository: () => void;
  readonly selectRepositoryByPosition: (position: number) => void;
  readonly selectableRepositoryCount: number;
  readonly settingsOpen: boolean;
  readonly showOpenProject: () => void;
  readonly toggleSidebar: () => void;
}) {
  const { bindings, platform } = useKeyboardShortcuts();

  useEffect(() => {
    const commands: readonly ShortcutCommand[] = [
      ["settings.open", true, () => openSettings(true)],
      [
        "repository.openSettings",
        hasSelectedRepository,
        openRepositorySettings,
      ],
      ["projects.showOpenProject", true, showOpenProject],
      [
        "projects.browseRepository",
        availability === "available",
        openFolderPicker,
      ],
      [
        "projects.closeActiveRepository",
        hasSelectedRepository,
        closeSelectedRepository,
      ],
      ["projects.focusFilter", true, focusSidebarFilter],
      ["projects.toggleSidebar", true, toggleSidebar],
      [
        "branches.focusSidebar",
        hasSelectedRepository && !repositorySettingsOpen,
        focusBranchesSidebar,
      ],
      [
        "projects.selectPreviousRepository",
        selectableRepositoryCount > 0,
        selectPreviousRepository,
      ],
      [
        "projects.selectNextRepository",
        selectableRepositoryCount > 0,
        selectNextRepository,
      ],
      ...repositorySelectionPositions.map(
        (position): ShortcutCommand => [
          repositorySelectionCommandId(position),
          position === 9
            ? selectableRepositoryCount > 0
            : position <= selectableRepositoryCount,
          () => selectRepositoryByPosition(position),
        ],
      ),
    ];

    const handleApplicationShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (folderPickerOpen) return;

      if (event.key === "Escape" && settingsOpen) {
        event.preventDefault();
        openSettings(false);
        return;
      }
      if (settingsOpen) return;

      const matched = commands.find(
        ([commandId, enabled]) =>
          enabled &&
          matchesKeyboardShortcut(event, bindings[commandId], platform),
      );
      if (matched === undefined) return;
      event.preventDefault();
      matched[2]();
    };

    window.addEventListener("keydown", handleApplicationShortcut);
    return () =>
      window.removeEventListener("keydown", handleApplicationShortcut);
  }, [
    availability,
    bindings,
    closeSelectedRepository,
    folderPickerOpen,
    focusBranchesSidebar,
    focusSidebarFilter,
    hasSelectedRepository,
    openFolderPicker,
    openSettings,
    openRepositorySettings,
    repositorySettingsOpen,
    platform,
    selectNextRepository,
    selectPreviousRepository,
    selectRepositoryByPosition,
    selectableRepositoryCount,
    settingsOpen,
    showOpenProject,
    toggleSidebar,
  ]);
}
