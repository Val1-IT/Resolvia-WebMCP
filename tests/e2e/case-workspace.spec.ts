import { rm } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  serializeStripeFixture,
  signStripeFixture,
} from "@/tests/fixtures/stripe";

const E2E_DATA_PATH = path.join(process.cwd(), ".data", "resolvia-e2e.json");

test("keeps deterministic RV-1028 authoritative during degraded analysis", async ({
  page,
}, testInfo) => {
  await rm(E2E_DATA_PATH, { force: true });
  await page.goto("/cases/RV-1028");

  await expect(page.getByRole("heading", { name: /RV-1028/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "AI RESOLUTION ANALYSIS" }),
  ).toBeVisible();
  await expect(page.getByText("DETERMINISTIC CASE STATUS", { exact: true })).toBeVisible();
  await expect(page.getByText("INVESTIGATING", { exact: true })).toBeVisible();
  await expect(page.getByText("AUTHENTICATED CLAIM", { exact: true })).toBeVisible();
  await expect(page.getByText("UNVERIFIED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("UNKNOWN", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("DETERMINISTIC FACT").first()).toBeVisible();
  await expect(page.getByText("VERIFICATION GAP", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("PROVIDER VERIFIED", { exact: true })).toHaveCount(0);
  await expect(page.getByText("DERIVED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("NOT AUTHORITATIVE", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".graph-node-type", { hasText: "TRANSACTION" })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /send/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /execute/i })).toHaveCount(0);

  const analyzeControl = page.getByRole("button", {
    name: /Analyze case|Refresh analysis/,
  });
  await expect(analyzeControl).toBeVisible();
  await analyzeControl.click();

  await expect(page.getByText("Agent analysis unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("UNAVAILABLE", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Agent analysis unavailable. Deterministic case data is unchanged.",
  );
  await expect(page.getByText("INVESTIGATING", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Refund transaction has not yet been independently verified.",
    ).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Obtain traceable provider evidence.", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("WEBMCP / AGENT COLLABORATION", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("NOT READY", { exact: true })).toBeVisible();
  await expect(page.getByText("v4", { exact: true })).toBeVisible();
  await expect(page.getByText("PROVIDER VERIFIED", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);

  const rawBody = serializeStripeFixture();
  const webhookStatus = await page.evaluate(
    async ({ body, signature }) =>
      (
        await fetch("/api/providers/stripe/webhook", {
          method: "POST",
          body,
          headers: {
            "content-type": "application/json",
            "stripe-signature": signature,
          },
        })
      ).status,
    {
      body: rawBody,
      signature: signStripeFixture(rawBody),
    },
  );
  expect(webhookStatus).toBe(202);

  await page.reload();
  await expect(page.getByText("v5", { exact: true })).toBeVisible();
  await expect(page.getByText("INVESTIGATING", { exact: true })).toBeVisible();
  await expect(
    page.getByText("PROVIDER VERIFIED", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".graph-node-type", { hasText: "TRANSACTION" }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Authoritative Stripe Test Mode refund re_test_refund exists."),
  ).toBeVisible();
  await expect(
    page.getByText("Stripe Test Mode reports processor status PENDING."),
  ).toBeVisible();
  await expect(
    page.getByText("Customer received funds", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("STALE", { exact: true })).toBeVisible();
  await expect(page.getByText("Case v4", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Customer outcome verification gap", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /send/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /execute/i })).toHaveCount(0);

  await page.screenshot({
    path: testInfo.outputPath("rv-1028-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: /RV-1028/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "AI RESOLUTION ANALYSIS" }),
  ).toBeVisible();

  const centerColumn = await page.locator(".center-column").boundingBox();
  const leftRail = await page.locator(".left-rail").boundingBox();
  const analysisPanel = await page.locator(".analysis-panel").boundingBox();
  const statusPanel = await page.locator(".status-panel").boundingBox();
  expect(centerColumn).not.toBeNull();
  expect(leftRail).not.toBeNull();
  expect(analysisPanel).not.toBeNull();
  expect(statusPanel).not.toBeNull();
  expect(Math.abs((centerColumn?.x ?? 0) - (leftRail?.x ?? 0))).toBeLessThan(2);
  expect(leftRail?.y ?? 0).toBeGreaterThan(centerColumn?.y ?? 0);
  expect(Math.abs((analysisPanel?.x ?? 0) - (statusPanel?.x ?? 0))).toBeLessThan(2);
  expect(statusPanel?.y ?? 0).toBeGreaterThan(analysisPanel?.y ?? 0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await page.screenshot({
    path: testInfo.outputPath("rv-1028-mobile.png"),
    fullPage: true,
  });
});