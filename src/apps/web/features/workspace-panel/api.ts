import { createContext, useContext } from "react";
import type {
  WorkspacePanelEnvironment,
  WorkspacePanelScope,
} from "#web/features/workspace-panel/workspace-panel-session.ts";

export const PanelFeatureContext = createContext<
  | {
      readonly scope: WorkspacePanelScope | undefined;
      readonly environment: WorkspacePanelEnvironment | undefined;
      readonly active: boolean;
      readonly input: unknown;
      readonly expanded: boolean;
      readonly expand: (expanded: boolean) => void;
    }
  | undefined
>(undefined);

export function usePanelFeature() {
  return useContext(PanelFeatureContext);
}
