export type RateLimitScope = "PROVIDER" | "PARTNER" | "SESSION" | "INTERNAL";

export type RateLimitInput = {
  scope: RateLimitScope;
  key: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export type RateLimit = (input: RateLimitInput) => Promise<RateLimitDecision>;

export interface RateLimiter {
  consume(input: RateLimitInput): Promise<RateLimitDecision>;
}