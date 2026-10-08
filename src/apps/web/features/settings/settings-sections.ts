import {
  IconActivity,
  IconDatabase,
  IconGitBranch,
  IconLicense,
  IconSettings,
  type TablerIcon,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import type {
  DesktopUpdateSnapshot,
  DesktopUpdates,
} from "#contracts/desktop-updates/desktop-updates.contract.ts";
import { DiagnosticsSettings } from "#web/features/diagnostics/diagnostics-settings.tsx";
import { GeneralSettings } from "#web/features/settings/general-settings.tsx";
import { HistoryStorageSettings } from "#web/features/settings/history-storage-settings.tsx";
import { LicensesSettings } from "#web/features/settings/licenses-settings.tsx";
import { SourceControlSettings } from "#web/features/settings/source-control-settings.tsx";

export type SettingsSectionId =
  | "general"
  | "source-control"
  | "history-storage"
  | "licenses"
  | "diagnostics";

export interface SettingsSectionContext {
  readonly desktopUpdates: DesktopUpdates | undefined;
  readonly productVersion: string;
  readonly selectSection: (section: SettingsSectionId) => void;
  readonly updateLoadError: string | undefined;
  readonly updateSnapshot: DesktopUpdateSnapshot | undefined;
}

interface SettingsSectionDefinition {
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly icon: TablerIcon;
  readonly parent?: SettingsSectionId;
  readonly Content: ComponentType<SettingsSectionContext>;
}

export const settingsSections: readonly SettingsSectionDefinition[] = [
  {
    id: "general",
    label: "General",
    icon: IconSettings,
    Content: GeneralSettings,
  },
  {
    id: "source-control",
    label: "Source control",
    icon: IconGitBranch,
    Content: SourceControlSettings,
  },
  {
    id: "history-storage",
    label: "History storage",
    icon: IconDatabase,
    Content: HistoryStorageSettings,
  },
  {
    id: "licenses",
    label: "Licenses",
    icon: IconLicense,
    parent: "general",
    Content: LicensesSettings,
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    icon: IconActivity,
    parent: "general",
    Content: DiagnosticsSettings,
  },
];
