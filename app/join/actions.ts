"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MEMBERSHIP_PLANS, membershipProvider } from "@/lib/membership";
import { squareCheckout, stripeCheckout } from "@/lib/payments";
import { env } from "@/lib/env";

export type JoinState = { ok: boolean; preview?: boolean; message: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Join RMEC: save the application as pending, then send the rider to the payment provider.
 * With no provider switched on (MEMBERSHIP_PROVIDER unset), it checks the form and stops
 * before saving anything, so the page can be shown as a preview.
 */
export async function startMembership(_prev: JoinState, formData: FormData): Promise<JoinState> {
  if (text(formData, "website")) return { ok: true, message: "Thanks!" }; // bot trap

  const plan = MEMBERSHIP_PLANS.find((p) => p.id === text(formData, "plan"));
  const firstName = text(formData, "firstName");
  const lastName = text(formData, "lastName");
  const email = text(formData, "email");
  if (!plan) return { ok: false, message: "Please choose a membership." };
  if (!firstName || !lastName) return { ok: false, message: "Please enter your first and last name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Please enter a valid email address." };
  if (formData.get("agree") !== "on") return { ok: false, message: "Please agree to the membership terms." };

  const provider = membershipProvider();
  if (provider === "livelaps") {
    const url = env("LIVELAPS_MEMBERSHIP_URL");
    if (url) redirect(url);
    return { ok: false, message: "Online membership isn't available right now." };
  }
  if (provider === "preview") {
    return {
      ok: true,
      preview: true,
      message: `Preview only: online payments aren't switched on yet, so nothing was saved or charged. When they are, ${firstName} would go to a secure payment page for the ${plan.name}.`,
    };
  }
  if (plan.priceCents == null) return { ok: false, message: "This membership's price hasn't been set yet." };

  const client = getSupabaseServerClient();
  const token = env("PAYMENTS_TOKEN");
  if (!client || !token) return { ok: false, message: "Online membership isn't available right now." };

  const birthDate = text(formData, "birthDate");
  const { data: applicationId, error } = await client.rpc("start_membership_application", {
    p_season_year: new Date().getFullYear(),
    p_plan: plan.id,
    p_price_cents: plan.priceCents,
    p_rider_id: UUID.test(text(formData, "riderId")) ? text(formData, "riderId") : null,
    p_first_name: firstName,
    p_last_name: lastName,
    p_email: email,
    p_phone: text(formData, "phone") || null,
    p_birth_date: /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? birthDate : null,
    p_city: text(formData, "city") || null,
    p_state: text(formData, "state") || null,
    p_emergency_contact: text(formData, "emergencyContact") || null,
    p_agreed: true,
  });
  if (error || typeof applicationId !== "string") {
    const known = /^(Please|Too many)/.test(error?.message ?? "");
    return { ok: false, message: known ? error!.message : "Your membership couldn't be started. Please try again." };
  }

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  let checkoutUrl: string;
  try {
    const input = {
      applicationId,
      planName: `RMEC ${plan.name} ${new Date().getFullYear()}`,
      priceCents: plan.priceCents,
      email,
      successUrl: `${origin}/join/thanks`,
      cancelUrl: `${origin}/join`,
    };
    const checkout = provider === "stripe" ? await stripeCheckout(input) : await squareCheckout(input);
    await client.rpc("attach_membership_checkout", {
      p_id: applicationId,
      p_provider: provider,
      p_reference: checkout.reference,
      p_token: token,
    });
    checkoutUrl = checkout.url;
  } catch {
    return { ok: false, message: "The payment page couldn't be opened. Please try again in a minute." };
  }
  redirect(checkoutUrl);
}
