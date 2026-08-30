import { describe, expect, it } from "vitest";

import { buildCaseWorkspaceViewModel } from "@/src/ui/case-workspace/model";
import { initialRefundBundle, makeEvent } from "@/tests/fixtures/domain";

describe("case workspace history pagination", () => {
  it("renders a bounded latest-first history page without changing Truth Graph authority", () => {
    const bundle = initialRefundBundle();
    bundle.events = Array.from({ length: 55 }, (_, index) => makeEvent({
      id: `event-page-${String(index).padStart(2, "0")}`,
      occurredAt: `2026-08-12T12:${String(index).padStart(2, "0")}:00.000Z`,
      receivedAt: `2026-08-12T12:${String(index).padStart(2, "0")}:01.000Z`,
    }));
    const fullGraph = buildCaseWorkspaceViewModel(bundle).truthGraph;
    const page = buildCaseWorkspaceViewModel(bundle, { historyPage: 2, historyPageSize: 10 });

    expect(page.timeline).toHaveLength(10);
    expect(page.timeline[0]?.id).toBe("event-page-44");
    expect(page.timeline[9]?.id).toBe("event-page-35");
    expect(page.historyPagination).toEqual({
      page: 2,
      pageSize: 10,
      totalTimelineItems: 55,
      totalAuditItems: bundle.auditRecords.length,
      totalPages: 6,
      hasPrevious: true,
      hasNext: true,
    });
    expect(page.truthGraph).toEqual(fullGraph);
  });

  it("clamps invalid page parameters to bounded values", () => {
    const page = buildCaseWorkspaceViewModel(initialRefundBundle(), { historyPage: -4, historyPageSize: 500 });
    expect(page.historyPagination.page).toBe(1);
    expect(page.historyPagination.pageSize).toBe(50);
  });
});