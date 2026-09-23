import { IconDatabase, IconSettings } from "@tabler/icons-react";
import type { SettingsSectionDefinition } from "#web/features/settings/settings.contract";
import { GeneralSettings } from "#web-ui/features/settings/general-settings";
import { HistoryStorageSettings } from "#web-ui/features/settings/history-storage-settings";

export const settingsSections = [
  {
    id: "general",
    label: "General",
    icon: IconSettings,
    Content: GeneralSettings,
  },
  {
    id: "history-storage",
    label: "History storage",
    icon: IconDatabase,
    Content: HistoryStorageSettings,
  },
] as const satisfies readonly SettingsSectionDefinition[];

export type SettingsSectionId = (typeof settingsSections)[number]["id"];
