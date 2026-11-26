"use client";

import { useActionState, useMemo, useState } from "react";
import { inputClassName } from "@/components/ui";
import type { MembershipPlan, MembershipProvider } from "@/lib/membership";
import { formatPrice } from "@/lib/membership";
import { startMembership, type JoinState } from "./actions";

export type JoinRider = { id: string; name: string; number: string | null; classes: string };

const label = "mb-2 block text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400";

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

export default function JoinForm({
  plans,
  provider,
  riders,
}: {
  plans: MembershipPlan[];
  provider: MembershipProvider;
  riders: JoinRider[];
}) {
  const [state, action, pending] = useActionState<JoinState, FormData>(startMembership, null);
  const [plan, setPlan] = useState(plans[0]?.id ?? "");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [riderId, setRiderId] = useState("");

  const matches = useMemo(() => {
    const last = norm(lastName);
    if (last.length < 2) return [];
    const first = norm(firstName);
    return riders
      .filter((r) => {
        const parts = norm(r.name).split(" ");
        return parts[parts.length - 1]?.startsWith(last) && (!first || parts[0]?.startsWith(first.slice(0, 2)));
      })
      .slice(0, 6);
  }, [riders, firstName, lastName]);

  const chosen = plans.find((p) => p.id === plan);
  const button =
    provider === "livelaps"
      ? "Continue to LiveLaps"
      : chosen?.priceCents != null
        ? `Continue to payment · ${formatPrice(chosen.priceCents)}`
        : "Continue to payment";

  if (state?.ok && !state.preview) {
    return (
      <div className="rounded-2xl border border-lime-400/30 bg-lime-400/5 p-8">
        <p className="text-neutral-200">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-6 rounded-2xl border border-white/10 bg-[#141816] p-6 sm:p-8">
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {provider === "preview" && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-100">
          <strong className="text-amber-300">Preview.</strong> Online payments aren&apos;t switched on yet, so this
          form won&apos;t save or charge anything.
        </p>
      )}

      <fieldset>
        <legend className={label}>Membership</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => (
            <label key={p.id}
              className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-4 transition ${
                plan === p.id ? "border-lime-400 bg-lime-400/10" : "border-white/10 hover:border-white/25"}`}>
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-3">
                  <input type="radio" name="plan" value={p.id} checked={plan === p.id}
                    onChange={() => setPlan(p.id)} className="accent-lime-400" />
                  <span className="font-black uppercase text-white">{p.name}</span>
                </span>
                <span className="font-black text-lime-400">{formatPrice(p.priceCents)}</span>
              </span>
              <span className="pl-7 text-sm text-neutral-400">{p.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="firstName" className={label}>First name</label>
          <input id="firstName" name="firstName" required maxLength={60} autoComplete="given-name"
            value={firstName} onChange={(e) => { setFirstName(e.target.value); setRiderId(""); }}
            className={inputClassName} />
        </div>
        <div>
          <label htmlFor="lastName" className={label}>Last name</label>
          <input id="lastName" name="lastName" required maxLength={60} autoComplete="family-name"
            value={lastName} onChange={(e) => { setLastName(e.target.value); setRiderId(""); }}
            className={inputClassName} />
        </div>
      </div>

      {matches.length > 0 && (
        <fieldset className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <legend className={`${label} px-1`}>Is one of these you? (links your results to your membership)</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {matches.map((r) => (
              <label key={r.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                  riderId === r.id ? "border-lime-400 bg-lime-400/10" : "border-white/10 hover:border-white/25"}`}>
                <input type="radio" name="riderChoice" className="mt-1 accent-lime-400"
                  checked={riderId === r.id} onChange={() => setRiderId(r.id)} />
                <span>
                  <span className="font-bold text-white">{r.name}</span>
                  {r.number && <span className="ml-1 text-neutral-500">#{r.number}</span>}
                  {r.classes && <span className="block text-xs text-neutral-400">{r.classes}</span>}
                </span>
              </label>
            ))}
            <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
              riderId === "" ? "border-lime-400 bg-lime-400/10" : "border-white/10 hover:border-white/25"}`}>
              <input type="radio" name="riderChoice" className="accent-lime-400"
                checked={riderId === ""} onChange={() => setRiderId("")} />
              <span className="text-neutral-300">None of these / I haven&apos;t raced yet</span>
            </label>
          </div>
        </fieldset>
      )}
      <input type="hidden" name="riderId" value={riderId} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="email" className={label}>Email</label>
          <input id="email" name="email" type="email" required maxLength={200} autoComplete="email"
            className={inputClassName} />
        </div>
        <div>
          <label htmlFor="phone" className={label}>Phone</label>
          <input id="phone" name="phone" type="tel" maxLength={30} autoComplete="tel" className={inputClassName} />
        </div>
        <div>
          <label htmlFor="birthDate" className={label}>Date of birth</label>
          <input id="birthDate" name="birthDate" type="date" className={inputClassName} />
        </div>
        <div>
          <label htmlFor="city" className={label}>City</label>
          <input id="city" name="city" maxLength={80} autoComplete="address-level2" className={inputClassName} />
        </div>
        <div>
          <label htmlFor="state" className={label}>State</label>
          <input id="state" name="state" maxLength={40} autoComplete="address-level1" className={inputClassName} />
        </div>
        <div>
          <label htmlFor="emergencyContact" className={label}>Emergency contact</label>
          <input id="emergencyContact" name="emergencyContact" maxLength={120} placeholder="Name and phone"
            className={inputClassName} />
        </div>
      </div>

      <label className="flex items-start gap-3 text-sm text-neutral-300">
        <input type="checkbox" name="agree" required className="mt-1 accent-lime-400" />
        <span>
          I agree to follow the RMEC rulebook. (Placeholder: the board&apos;s membership terms, waiver and refund
          policy go here.)
        </span>
      </label>

      {state && (
        <p role={state.ok ? "status" : "alert"}
          className={`rounded-xl border px-4 py-3 text-sm ${state.ok
            ? "border-amber-400/30 bg-amber-400/5 text-amber-100"
            : "border-red-400/30 bg-red-400/5 text-red-200"}`}>
          {state.message}
        </p>
      )}

      <button type="submit" disabled={pending}
        className="w-full rounded-xl bg-lime-400 px-6 py-3.5 text-sm font-black uppercase tracking-wide text-[#101211] shadow-[0_8px_24px_-10px_rgba(163,230,53,0.7)] transition hover:bg-lime-300 disabled:opacity-50 sm:w-auto">
        {pending ? "One moment…" : button}
      </button>
    </form>
  );
}
