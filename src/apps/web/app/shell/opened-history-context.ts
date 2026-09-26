import { createContext, useContext } from "react";
import type { OpenedRepositoryHistory } from "#web/app/shell/opened-repository";

export const OpenedHistoryContext = createContext<
  OpenedRepositoryHistory | undefined
>(undefined);

export function useOpenedHistory() {
  return useContext(OpenedHistoryContext);
}
