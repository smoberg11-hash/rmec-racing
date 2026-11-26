"use client";

import { useActionState, useMemo, useState } from "react";
import { inputClassName, SelectField } from "@/components/ui";
import { submitCreditRequest, type RequestState } from "./actions";

export type FormRider = { id: string; name: string; number: string | null; classes: string };
export type FormEvent = { id: string; name: string; date: string | null };

const label = "mb-2 block text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400";

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function WorkerPointsForm({ riders, events }: { riders: FormRider[]; events: FormEvent[] }) {
  const [state, action, pending] = useActionState<RequestState, FormData>(submitCreditRequest, null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [riderId, setRiderId] = useState("");
  const [eventId, setEventId] = useState("");

  // Riders whose last name matches (and first name, once typed), so people pick their own profile.
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

  const upcoming = events.filter((e) => !e.date || e.date >= todayKey());
  const earlier = events.filter((e) => e.date && e.date < todayKey()).reverse();
  const picked = riders.find((r) => r.id === riderId);

  if (state?.ok) {
    return (
      <div className="rounded-2xl border border-lime-400/30 bg-lime-400/5 p-8">
        <h2 className="text-2xl font-black uppercase text-lime-300">Request sent</h2>
        <p className="mt-3 text-neutral-300">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-6 rounded-2xl border border-white/10 bg-[#141816] p-6 sm:p-8">
      {/* Bots fill this in; people never see it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

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
          <legend className={`${label} px-1`}>Is one of these you?</legend>
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
      <input type="hidden" name="riderName" value={picked ? picked.name : ""} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="email" className={label}>Email address</label>
          <input id="email" name="email" type="email" required maxLength={200} autoComplete="email"
            placeholder="example@example.com" className={inputClassName} />
        </div>
        <div>
          <label htmlFor="phone" className={label}>Phone number</label>
          <input id="phone" name="phone" type="tel" maxLength={30} autoComplete="tel"
            placeholder="(000) 000-0000" className={inputClassName} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="classText" className={label}>Class</label>
          <input id="classText" name="classText" maxLength={80} placeholder="e.g. B 50+"
            defaultValue="" className={inputClassName} />
        </div>
        <div>
          <SelectField id="eventId" name="eventId" label="Event you want to work or gain eligibility" required
            value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="" disabled>Please select</option>
            {upcoming.length > 0 && (
              <optgroup label="Upcoming">
                {upcoming.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </optgroup>
            )}
            {earlier.length > 0 && (
              <optgroup label="Earlier this season">
                {earlier.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </optgroup>
            )}
          </SelectField>
          <input type="hidden" name="eventName" value={events.find((e) => e.id === eventId)?.name ?? ""} />
        </div>
        <div>
          <SelectField id="kind" name="kind" label="I intend to work / earn" required defaultValue="">
            <option value="" disabled>Please select</option>
            <option value="worker_points">Worker Points</option>
            <option value="eligibility">Eligibility</option>
          </SelectField>
        </div>
      </div>

      {state && !state.ok && (
        <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-200">
          {state.message}
        </p>
      )}

      <button type="submit" disabled={pending}
        className="w-full rounded-xl bg-lime-400 px-6 py-3.5 text-sm font-black uppercase tracking-wide text-[#101211] shadow-[0_8px_24px_-10px_rgba(163,230,53,0.7)] transition hover:bg-lime-300 disabled:opacity-50 sm:w-auto">
        {pending ? "Sending…" : "Submit request"}
      </button>
    </form>
  );
}
