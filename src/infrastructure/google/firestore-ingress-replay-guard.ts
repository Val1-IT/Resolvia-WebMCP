import { createHmac } from "node:crypto";

import type { Firestore } from "@google-cloud/firestore";
import { z } from "zod";

import type {
  IngressReplayClaim,
  IngressReplayDecision,
  IngressReplayGuard,
} from "@/src/application/ports/ingress-replay-guard";
import { firestoreCollection } from "@/src/infrastructure/google/firestore-codec";

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const SafeIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:/-]+$/u);
const TimestampSchema = z.string().datetime({ offset: true });
const StoredReplayReceiptSchema = z
  .object({
    scope: z.literal("DEMO_PROVIDER"),
    payloadDigest: DigestSchema,
    semanticId: SafeIdSchema,
    state: z.enum(["LEASED", "PUBLISHED", "FAILED_RETRYABLE"]),
    leaseId: SafeIdSchema,
    leaseUntil: TimestampSchema,
    expiresAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

type StoredReplayReceipt = z.infer<typeof StoredReplayReceiptSchema>;

export class IngressReplayError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "INVALID_RECORD"
      | "REPLAY_CONFLICT"
      | "LEASE_NOT_OWNED",
  ) {
    super(code);
    this.name = "IngressReplayError";
  }
}

export class FirestoreIngressReplayGuard implements IngressReplayGuard {
  constructor(
    private readonly firestore: Firestore,
    private readonly collectionPrefix: string,
    private readonly hmacSecret: string,
  ) {
    if (!/^[A-Za-z0-9_-]{1,100}$/u.test(collectionPrefix)) {
      throw new IngressReplayError("INVALID_INPUT");
    }
    if (Buffer.byteLength(hmacSecret, "utf8") < 32) {
      throw new IngressReplayError("INVALID_INPUT");
    }
  }

  async claim(input: IngressReplayClaim): Promise<IngressReplayDecision> {
    validateClaim(input);
    const reference = this.reference(input);
    const nowMs = Date.parse(input.now);

    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) {
        const stored = parseStored(snapshot.data());
        assertSameReplay(stored, input);
        if (stored.state === "PUBLISHED") return { kind: "DUPLICATE" };
        if (
          stored.state === "LEASED" &&
          Date.parse(stored.leaseUntil) > nowMs
        ) {
          return { kind: "IN_PROGRESS" };
        }
      }

      transaction.set(reference, leasedReceipt(input));
      return { kind: "CLAIMED" };
    });
  }

  async markPublished(input: IngressReplayClaim): Promise<void> {
    validateClaim(input);
    const reference = this.reference(input);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new IngressReplayError("LEASE_NOT_OWNED");
      const stored = parseStored(snapshot.data());
      assertSameReplay(stored, input);
      if (stored.state === "PUBLISHED") return;
      assertLeaseOwner(stored, input);
      transaction.set(reference, {
        ...stored,
        state: "PUBLISHED",
        updatedAt: input.now,
      } satisfies StoredReplayReceipt);
    });
  }

  async release(input: IngressReplayClaim): Promise<void> {
    validateClaim(input);
    const reference = this.reference(input);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new IngressReplayError("LEASE_NOT_OWNED");
      const stored = parseStored(snapshot.data());
      assertSameReplay(stored, input);
      if (stored.state === "PUBLISHED") return;
      assertLeaseOwner(stored, input);
      transaction.set(reference, {
        ...stored,
        state: "FAILED_RETRYABLE",
        leaseUntil: input.now,
        updatedAt: input.now,
      } satisfies StoredReplayReceipt);
    });
  }

  private reference(input: IngressReplayClaim) {
    const documentId = createHmac("sha256", this.hmacSecret)
      .update(`${input.scope}\u0000${input.replayKey}`, "utf8")
      .digest("base64url");
    return this.firestore
      .collection(
        firestoreCollection(this.collectionPrefix, "ingressReplayReceipts"),
      )
      .doc(documentId);
  }
}

function validateClaim(input: IngressReplayClaim): void {
  const parsed = z
    .object({
      scope: z.literal("DEMO_PROVIDER"),
      replayKey: z
        .string()
        .min(16)
        .max(128)
        .regex(/^[A-Za-z0-9_-]+$/u),
      payloadDigest: DigestSchema,
      semanticId: SafeIdSchema,
      leaseId: SafeIdSchema,
      now: TimestampSchema,
      leaseUntil: TimestampSchema,
      expiresAt: TimestampSchema,
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) throw new IngressReplayError("INVALID_INPUT");
  const nowMs = Date.parse(input.now);
  const leaseUntilMs = Date.parse(input.leaseUntil);
  const expiresAtMs = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(nowMs) ||
    leaseUntilMs <= nowMs ||
    expiresAtMs < leaseUntilMs ||
    expiresAtMs - nowMs > 24 * 60 * 60 * 1_000
  ) {
    throw new IngressReplayError("INVALID_INPUT");
  }
}

function leasedReceipt(input: IngressReplayClaim): StoredReplayReceipt {
  return StoredReplayReceiptSchema.parse({
    scope: input.scope,
    payloadDigest: input.payloadDigest,
    semanticId: input.semanticId,
    state: "LEASED",
    leaseId: input.leaseId,
    leaseUntil: input.leaseUntil,
    expiresAt: input.expiresAt,
    updatedAt: input.now,
  });
}

function parseStored(value: unknown): StoredReplayReceipt {
  const parsed = StoredReplayReceiptSchema.safeParse(value);
  if (!parsed.success) throw new IngressReplayError("INVALID_RECORD");
  return parsed.data;
}

function assertSameReplay(
  stored: StoredReplayReceipt,
  input: IngressReplayClaim,
): void {
  if (
    stored.scope !== input.scope ||
    stored.payloadDigest !== input.payloadDigest ||
    stored.semanticId !== input.semanticId
  ) {
    throw new IngressReplayError("REPLAY_CONFLICT");
  }
}

function assertLeaseOwner(
  stored: StoredReplayReceipt,
  input: IngressReplayClaim,
): void {
  if (stored.state !== "LEASED" || stored.leaseId !== input.leaseId) {
    throw new IngressReplayError("LEASE_NOT_OWNED");
  }
}
