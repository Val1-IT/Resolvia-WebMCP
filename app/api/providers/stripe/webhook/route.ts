import { createProviderEventPublisher } from "@/src/application/events/process-provider-event";
import type {
  ProviderAdapter,
  ResolutionEventPublisher,
} from "@/src/application/ports/external-services";
import type { ResolutionEvent } from "@/src/domain/events/model";
import {
  StripeProviderAdapter,
  StripeProviderError,
  type StripeWebhookInput,
} from "@/src/infrastructure/providers/stripe/stripe-provider-adapter";
import { getLocalResolutionStore } from "@/src/infrastructure/local/get-local-store";
import {
  BoundedBodyError,
  readBoundedBody,
} from "@/src/infrastructure/http/bounded-body";
import type Stripe from "stripe";

const MAX_WEBHOOK_BYTES = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  if (process.env.RESOLVIA_RUNTIME_MODE !== "LOCAL") {
    return Response.json({ error: "UNSUPPORTED_RUNTIME_MODE" }, { status: 503 });
  }

  try {
    const adapter = new StripeProviderAdapter({
      apiKey: process.env.STRIPE_SECRET_KEY ?? "",
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    });
    return createStripeWebhookHandler({
      adapter,
      publisher: createProviderEventPublisher(getLocalResolutionStore()),
    })(request);
  } catch (error) {
    if (error instanceof StripeProviderError) {
      return Response.json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 503 });
    }
    return Response.json({ error: "PROVIDER_PROCESSING_FAILED" }, { status: 503 });
  }
}

type StripeWebhookHandlerDependencies = {
  adapter: ProviderAdapter<StripeWebhookInput, Stripe.Event>;
  publisher: ResolutionEventPublisher;
};

export function createStripeWebhookHandler(
  dependencies: StripeWebhookHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const rawBody = await readBoundedBody(request, MAX_WEBHOOK_BYTES, ["application/json"]);
      const signature = request.headers.get("stripe-signature");
      const authenticated = await dependencies.adapter.authenticate({
        rawBody,
        signature,
      });
      const events = await dependencies.adapter.normalize(authenticated);
      if (events.length === 0) {
        return Response.json(
          { status: "IGNORED", published: 0 },
          { status: 202 },
        );
      }

      await publishAll(events, dependencies.publisher);
      return Response.json(
        { status: "ACCEPTED", published: events.length },
        { status: 202 },
      );
    } catch (error) {
      if (error instanceof BoundedBodyError) return bodyError(error);
      if (error instanceof StripeProviderError) {
        return Response.json({ error: "INVALID_WEBHOOK" }, { status: 400 });
      }
      return Response.json(
        { error: "PROVIDER_PROCESSING_FAILED" },
        { status: 503 },
      );
    }
  };
}

function bodyError(error: BoundedBodyError): Response {
  if (error.code === "BODY_TOO_LARGE") {
    return Response.json({ error: "REQUEST_TOO_LARGE" }, { status: 413 });
  }
  if (error.code === "UNSUPPORTED_MEDIA_TYPE") {
    return Response.json({ error: "UNSUPPORTED_MEDIA_TYPE" }, { status: 415 });
  }
  return Response.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
}

async function publishAll(
  events: ResolutionEvent[],
  publisher: ResolutionEventPublisher,
): Promise<void> {
  for (const event of events) await publisher.publish(event);
}
