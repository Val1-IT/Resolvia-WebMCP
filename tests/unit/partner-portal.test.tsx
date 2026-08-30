// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PartnerPortal } from "@/src/ui/components/partner-portal";

describe("PartnerPortal", () => {
  it("does not display scoped request data until the token-authenticated portal response succeeds", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        requestId: "partner-request-portal",
        caseDisplayId: "RV-1028",
        requestedEvidenceType: "CUSTOMER_RECEIPT",
        expiresAt: "2026-08-12T13:40:00.000Z",
      }),
    }));
    render(<PartnerPortal requestId="partner-request-portal" requestAccess={request} />);

    expect(screen.queryByText("RV-1028")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Partner access token"), {
      target: { value: "partner-token-abcdefghijklmnopqrstuvwxyz0123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open request" }));

    await waitFor(() => expect(screen.getByText("RV-1028")).toBeInTheDocument());
    expect(screen.getByText("CUSTOMER RECEIPT")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      "partner-request-portal",
      "partner-token-abcdefghijklmnopqrstuvwxyz0123456789",
    );
  });
});