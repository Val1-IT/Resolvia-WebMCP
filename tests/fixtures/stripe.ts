import Stripe from "stripe";

export const STRIPE_TEST_API_KEY = "sk_test_resolvia_fixture";
export const STRIPE_TEST_WEBHOOK_SECRET = "whsec_resolvia_fixture";
export const STRIPE_EVENT_CREATED_SECONDS = 1_786_262_400;

export type StripeRefundFixtureOptions = {
  eventId?: string;
  eventType?: string;
  livemode?: boolean;
  caseId?: string | null;
  refundId?: string | null;
  refundObject?: string;
  refundStatus?: string | null;
};

export function makeStripeRefundEventFixture(
  options: StripeRefundFixtureOptions = {},
) {
  const caseId = options.caseId === undefined ? "case-rv-1028" : options.caseId;
  return {
    id: options.eventId ?? "evt_test_refund",
    object: "event",
    api_version: "2026-07-29.basil",
    created: STRIPE_EVENT_CREATED_SECONDS,
    data: {
      object: {
        id: options.refundId === undefined ? "re_test_refund" : options.refundId,
        object: options.refundObject ?? "refund",
        created: STRIPE_EVENT_CREATED_SECONDS,
        metadata: caseId === null ? {} : { resolvia_case_id: caseId },
        status:
          options.refundStatus === undefined ? "pending" : options.refundStatus,
      },
    },
    livemode: options.livemode ?? false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: options.eventType ?? "refund.updated",
  };
}

export function serializeStripeFixture(
  options: StripeRefundFixtureOptions = {},
): string {
  return JSON.stringify(makeStripeRefundEventFixture(options));
}

export function signStripeFixture(
  rawBody: string,
  secret = STRIPE_TEST_WEBHOOK_SECRET,
): string {
  const stripe = new Stripe(STRIPE_TEST_API_KEY);
  return stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret,
  });
}
