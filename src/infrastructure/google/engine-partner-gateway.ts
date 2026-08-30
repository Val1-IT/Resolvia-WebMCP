import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

import { ResolutionEventSchema, type ResolutionEvent } from "@/src/domain/events/model";

export type PartnerPortalContext = {
  requestId: string;
  caseDisplayId: string;
  requestedEvidenceType: "SETTLEMENT_OCCURRED" | "CUSTOMER_RECEIPT";
  expiresAt: string;
};

export type PartnerGatewayResponse = {
  requestedEvidenceType: "SETTLEMENT_OCCURRED" | "CUSTOMER_RECEIPT";
  responseStatus: "CONFIRMED" | "NOT_CONFIRMED";
  responseReference: string;
  responseSummary: string;
};

type PreparedSubmission = { event: ResolutionEvent };
type EngineRequest = { url: string; method: "POST"; data: Record<string, unknown> };
type EngineClient = { request(request: EngineRequest): Promise<{ data: unknown }> };
export type EnginePartnerTokenClient = (audience: string) => Promise<EngineClient>;

const PartnerPortalContextSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  caseDisplayId: z.string().trim().min(1).max(128),
  requestedEvidenceType: z.enum(["SETTLEMENT_OCCURRED", "CUSTOMER_RECEIPT"]),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
const PreparedSubmissionSchema = z.object({ event: ResolutionEventSchema }).strict();

export class EnginePartnerGateway {
  constructor(
    private readonly audience: string,
    private readonly getIdTokenClient: EnginePartnerTokenClient = defaultTokenClient,
  ) {}

  async access(requestId: string, token: string): Promise<PartnerPortalContext | null> {
    return this.call({ operation: "access", requestId, token }, PartnerPortalContextSchema);
  }

  async prepareSubmission(
    requestId: string,
    token: string,
    response: PartnerGatewayResponse,
  ): Promise<PreparedSubmission | null> {
    return this.call({ operation: "prepare", requestId, token, response }, PreparedSubmissionSchema);
  }

  async releaseSubmission(requestId: string, eventId: string): Promise<boolean> {
    return (await this.call({ operation: "release", requestId, eventId }, z.object({}).strict())) !== null;
  }

  private async call<T>(data: Record<string, unknown>, schema: z.ZodType<T>): Promise<T | null> {
    try {
      const client = await this.getIdTokenClient(this.audience);
      const response = await client.request({
        url: new URL("/api/internal/partner", this.audience).toString(),
        method: "POST",
        data,
      });
      const parsed = schema.safeParse(response.data);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}

const defaultTokenClient: EnginePartnerTokenClient = async (audience) => {
  const client = await new GoogleAuth().getIdTokenClient(audience);
  return {
    request: async (request: EngineRequest) => {
      const response = await client.request<unknown>(request);
      return { data: response.data };
    },
  };
};