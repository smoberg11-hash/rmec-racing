"use server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export type RequestState = {
  ok: boolean;
  message: string;
} | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Saves a worker points / eligibility request as "pending" (Supabase function
 * submit_credit_request, see importer/credit_requests.sql), then emails the
 * notification address if email is set up. Nothing counts until it's approved.
 */
export async function submitCreditRequest(_prev: RequestState, formData: FormData): Promise<RequestState> {
  // Hidden field people never see; bots fill it in. Pretend it worked.
  if (text(formData, "website")) {
    return { ok: true, message: "Thanks! Your request was sent." };
  }

  const firstName = text(formData, "firstName");
  const lastName = text(formData, "lastName");
  const email = text(formData, "email");
  const phone = text(formData, "phone");
  const classText = text(formData, "classText");
  const eventId = text(formData, "eventId");
  const kind = text(formData, "kind");
  const riderId = text(formData, "riderId");

  if (!firstName || !lastName) return { ok: false, message: "Please enter your first and last name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Please enter a valid email address." };
  if (kind !== "worker_points" && kind !== "eligibility") {
    return { ok: false, message: "Please choose Worker Points or Eligibility." };
  }
  if (!UUID.test(eventId)) return { ok: false, message: "Please choose the event." };

  const client = getSupabaseServerClient();
  if (!client) return { ok: false, message: "The form isn't available right now. Please try again later." };

  const { error } = await client.rpc("submit_credit_request", {
    p_first_name: firstName,
    p_last_name: lastName,
    p_email: email,
    p_phone: phone || null,
    p_class_text: classText || null,
    p_event_id: eventId,
    p_kind: kind,
    p_rider_id: UUID.test(riderId) ? riderId : null,
  });
  if (error) {
    // The database function's own messages are written for riders; anything else is generic.
    const known = /^(Please|Too many)/.test(error.message ?? "");
    return { ok: false, message: known ? error.message : "Your request couldn't be saved. Please try again later." };
  }

  await notify({
    name: `${firstName} ${lastName}`,
    email,
    phone,
    classText,
    event: text(formData, "eventName"),
    kind: kind === "worker_points" ? "Worker Points" : "Eligibility",
    matched: text(formData, "riderName"),
  });

  return {
    ok: true,
    message:
      "Thanks! Your request was sent. The promoter will contact you, and it will count once it's approved.",
  };
}

/** Email the points keeper / promoter through Resend, when RESEND_API_KEY is set. Never blocks the form. */
async function notify(r: {
  name: string;
  email: string;
  phone: string;
  classText: string;
  event: string;
  kind: string;
  matched: string;
}) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.CREDIT_REQUEST_EMAIL_TO;
  if (!key || !to) return;
  const from = process.env.CREDIT_REQUEST_EMAIL_FROM || "RMEC Racing <onboarding@resend.dev>";
  const lines = [
    `${r.name} sent a ${r.kind} request.`,
    "",
    `Event: ${r.event || "—"}`,
    `Class: ${r.classText || "—"}`,
    `Email: ${r.email}`,
    `Phone: ${r.phone || "—"}`,
    `Rider profile: ${r.matched || "not picked (set rider_id before approving)"}`,
    "",
    "Approve it in Supabase: Table Editor > credit_requests > set status to approved.",
  ];
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        reply_to: r.email,
        subject: `RMEC ${r.kind} request: ${r.name} (${r.event || "no event"})`,
        text: lines.join("\n"),
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // The request is already saved; a failed email shouldn't fail the form.
  }
}
