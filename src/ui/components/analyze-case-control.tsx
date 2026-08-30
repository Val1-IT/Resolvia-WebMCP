"use client";

import { useActionState } from "react";

import {
  analyzeCaseAction,
  type AnalyzeCaseActionState,
} from "@/app/cases/[caseId]/actions";

const initialState: AnalyzeCaseActionState = { message: "" };

export function AnalyzeCaseControl({
  caseId,
  hasRun,
}: {
  caseId: string;
  hasRun: boolean;
}) {
  const boundAction = analyzeCaseAction.bind(null, caseId);
  const [state, formAction, isPending] = useActionState(
    boundAction,
    initialState,
  );

  return (
    <form className="analysis-control" action={formAction}>
      <button type="submit" disabled={isPending}>
        {isPending ? "Analyzing…" : hasRun ? "Refresh analysis" : "Analyze case"}
      </button>
      <p role="status" aria-live="polite">
        {state.message}
      </p>
    </form>
  );
}
