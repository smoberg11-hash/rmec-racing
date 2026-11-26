import { getSupabaseServerClient } from "@/lib/supabase/server";
import { squareWebhook, stripeWebhook, type PaidEvent } from "@/lib/payments";
import { env } from "@/lib/env";

/**
 * Payment webhooks: https://<your site>/api/payments/stripe and /api/payments/square.
 * Add that URL in the provider's dashboard when payments are switched on.
 * A verified "payment completed" event marks the membership paid (record_membership_payment).
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const rawBody = await request.text();

  let paid: PaidEvent | null;
  try {
    if (provider === "stripe") {
      paid = stripeWebhook(rawBody, request.headers.get("stripe-signature"));
    } else if (provider === "square") {
      const url = env("SQUARE_WEBHOOK_URL") ?? request.url; // must match the URL set in Square exactly
      paid = squareWebhook(rawBody, request.headers.get("x-square-hmacsha256-signature"), url);
    } else {
      return new Response("Unknown provider", { status: 404 });
    }
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  if (!paid) return new Response("Ignored", { status: 200 }); // some other event type

  const client = getSupabaseServerClient();
  const token = env("PAYMENTS_TOKEN");
  if (!client || !token) return new Response("Not configured", { status: 503 });

  const { error } = await client.rpc("record_membership_payment", {
    p_id: paid.applicationId ?? null,
    p_reference: paid.reference ?? null,
    p_payment_id: paid.paymentId,
    p_token: token,
  });
  // A failure makes the provider retry the webhook later.
  return error ? new Response("Could not record payment", { status: 500 }) : new Response("OK", { status: 200 });
}
