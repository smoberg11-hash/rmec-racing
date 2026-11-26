import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Payment providers for the Join page. Both are written against the providers' plain HTTP
 * APIs (no extra packages) and are OFF until MEMBERSHIP_PROVIDER and their keys are set.
 * NOT YET TESTED against live accounts: test with each provider's test/sandbox keys first.
 */

export type Checkout = { url: string; reference: string };

export type CheckoutInput = {
  applicationId: string;
  planName: string;
  priceCents: number;
  email: string;
  successUrl: string;
  cancelUrl: string;
};

/** A finished payment found in a webhook: which application, and the provider's payment id. */
export type PaidEvent = { applicationId?: string; reference?: string; paymentId: string };

// ----------------------------------------------------------------------------- Stripe

export async function stripeCheckout(input: CheckoutInput): Promise<Checkout> {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  const body = new URLSearchParams({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.email,
    client_reference_id: input.applicationId,
    "metadata[application_id]": input.applicationId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(input.priceCents),
    "line_items[0][price_data][product_data][name]": input.planName,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !json.url || !json.id) throw new Error(json.error?.message ?? "Stripe checkout failed.");
  return { url: json.url, reference: json.id };
}

/** Checks the Stripe-Signature header (t=…,v1=…) and returns the paid checkout, if any. */
export function stripeWebhook(rawBody: string, signatureHeader: string | null): PaidEvent | null {
  const secret = env("STRIPE_WEBHOOK_SECRET");
  if (!secret || !signatureHeader) throw new Error("Missing Stripe webhook secret or signature.");
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) throw new Error("Stale Stripe webhook.");
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  const given = signatureHeader
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!given.some((sig) => safeEqual(sig, expected))) throw new Error("Bad Stripe signature.");

  const event = JSON.parse(rawBody) as {
    type: string;
    data: { object: { id: string; client_reference_id?: string; payment_status?: string } };
  };
  if (event.type !== "checkout.session.completed" || event.data.object.payment_status !== "paid") return null;
  return {
    applicationId: event.data.object.client_reference_id,
    reference: event.data.object.id,
    paymentId: event.data.object.id,
  };
}

// ----------------------------------------------------------------------------- Square

const SQUARE_API = env("SQUARE_ENVIRONMENT") === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";
// Square dates its API versions; check https://developer.squareup.com for the current one.
const SQUARE_VERSION = env("SQUARE_API_VERSION") || "2025-01-23";

export async function squareCheckout(input: CheckoutInput): Promise<Checkout> {
  const token = env("SQUARE_ACCESS_TOKEN");
  const location = env("SQUARE_LOCATION_ID");
  if (!token || !location) throw new Error("SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID must be set.");
  const res = await fetch(`${SQUARE_API}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    body: JSON.stringify({
      idempotency_key: input.applicationId,
      quick_pay: {
        name: input.planName,
        price_money: { amount: input.priceCents, currency: "USD" },
        location_id: location,
      },
      checkout_options: { redirect_url: input.successUrl },
      pre_populated_data: { buyer_email: input.email },
      payment_note: `RMEC membership ${input.applicationId}`,
    }),
  });
  const json = (await res.json()) as {
    payment_link?: { url: string; order_id: string };
    errors?: { detail?: string }[];
  };
  if (!res.ok || !json.payment_link) throw new Error(json.errors?.[0]?.detail ?? "Square checkout failed.");
  // Square's webhook reports the order, so the order id links the payment to the application.
  return { url: json.payment_link.url, reference: json.payment_link.order_id };
}

/** Checks x-square-hmacsha256-signature (base64 HMAC of notification URL + body). */
export function squareWebhook(rawBody: string, signature: string | null, notificationUrl: string): PaidEvent | null {
  const key = env("SQUARE_WEBHOOK_SIGNATURE_KEY");
  if (!key || !signature) throw new Error("Missing Square webhook key or signature.");
  const expected = createHmac("sha256", key).update(notificationUrl + rawBody).digest("base64");
  if (!safeEqual(signature, expected)) throw new Error("Bad Square signature.");

  const event = JSON.parse(rawBody) as {
    type: string;
    data?: { object?: { payment?: { id: string; order_id?: string; status?: string } } };
  };
  const payment = event.data?.object?.payment;
  if (!event.type.startsWith("payment.") || payment?.status !== "COMPLETED" || !payment.order_id) return null;
  return { reference: payment.order_id, paymentId: payment.id };
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
