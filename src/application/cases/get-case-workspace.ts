import type { ResolutionStore } from "@/src/application/ports/resolution-store";
import {
  buildCaseWorkspaceViewModel,
  type CaseWorkspaceViewModel,
} from "@/src/ui/case-workspace/model";

export async function getCaseWorkspace(
  store: ResolutionStore,
  caseId: string,
  options: { historyPage?: number; historyPageSize?: number } = {},
): Promise<CaseWorkspaceViewModel | null> {
  const bundle = await store.loadCaseBundle(caseId);
  return bundle ? buildCaseWorkspaceViewModel(bundle, options) : null;
}
