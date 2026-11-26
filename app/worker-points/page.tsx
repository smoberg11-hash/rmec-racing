import { Suspense } from "react";
import { ButtonLink, Page, PageHeader } from "@/components/ui";
import { selectPublicRows } from "@/lib/supabase/data";
import WorkerPointsForm, { type FormEvent, type FormRider } from "./WorkerPointsForm";

type Season = { id: string; year: number };
type EventRow = { id: string; name: string; race_date: string | null; season_id: string };
type Rider = { id: string; full_name: string; rider_number: string | null };
type ResultRow = { rider_id: string; class_id: string };
type ClassRow = { id: string; name: string };

async function RequestForm() {
  const [seasonsRes, ridersRes, classesRes] = await Promise.all([
    selectPublicRows<Season>("seasons", "id, year", { orderBy: "year", ascending: false }),
    selectPublicRows<Rider>("public_riders", "id, full_name, rider_number"),
    selectPublicRows<ClassRow>("classes", "id, name"),
  ]);
  const season = seasonsRes.data?.find((s) => s.year === new Date().getFullYear()) ?? seasonsRes.data?.[0];
  if (!season || ridersRes.error) {
    return (
      <p className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-red-200">
        The form couldn&apos;t load. Please try again later.
      </p>
    );
  }

  const eventsRes = await selectPublicRows<EventRow>("events", "id, name, race_date, season_id", {
    equals: { column: "season_id", value: season.id },
    orderBy: "race_date",
    ascending: true,
  });
  const events = eventsRes.data ?? [];

  // Each rider's classes this season, so they can recognise their own profile.
  const resultsRes = await selectPublicRows<ResultRow>("results", "rider_id, class_id", {
    in: { column: "event_id", values: events.map((e) => e.id) },
  });
  const className = new Map((classesRes.data ?? []).map((c) => [c.id, c.name]));
  const classesByRider = new Map<string, Set<string>>();
  for (const r of resultsRes.data ?? []) {
    const name = className.get(r.class_id);
    if (!name) continue;
    if (!classesByRider.has(r.rider_id)) classesByRider.set(r.rider_id, new Set());
    classesByRider.get(r.rider_id)!.add(name);
  }

  const riders: FormRider[] = (ridersRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.full_name,
    number: r.rider_number,
    classes: [...(classesByRider.get(r.id) ?? [])].join(", "),
  }));
  const formEvents: FormEvent[] = events.map((e) => ({ id: e.id, name: e.name, date: e.race_date }));

  return <WorkerPointsForm riders={riders} events={formEvents} />;
}

export default function WorkerPointsPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Year-end awards"
        title="Worker Points & Eligibility"
        description="All RMEC riders who want to be eligible for a year-end award must earn either Worker Points or Eligibility. Send your request here and the promoter will contact you."
        actions={
          <ButtonLink href="/" back variant="secondary">
            Home
          </ButtonLink>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Suspense
          fallback={
            <div className="rounded-2xl border border-white/10 bg-[#141816] p-8 text-sm text-neutral-400">
              Loading the form…
            </div>
          }
        >
          <RequestForm />
        </Suspense>

        <aside className="space-y-4 text-sm leading-6 text-neutral-300">
          <div className="rounded-2xl border border-white/10 bg-[#141816] p-6">
            <h2 className="text-lg font-black uppercase text-white">Worker Points</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>Help a promoter with an event; the promoter sets the hours and days.</li>
              <li>Worth the average of your best 3 results, in place of a race you missed or your lowest result.</li>
              <li>One set per season, in one class.</li>
              <li>You can&apos;t earn race points and worker points at the same event.</li>
              <li>They only apply once you have raced 4 events, and only in the adult series.</li>
              <li>Worker points also earn your eligibility.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#141816] p-6">
            <h2 className="text-lg font-black uppercase text-white">Eligibility</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>Required for year-end awards, along with an RMEC membership and at least 4 races.</li>
              <li>Earned by helping at an event (you may still ride it, at the promoter&apos;s and chairman&apos;s discretion), worker points, sportsman points, or a $500 donation to a motorcycle charity.</li>
              <li>Youth 16 &amp; Under eligibility counts for both the junior and adult series.</li>
              <li>The deadline is the last race of the season.</li>
            </ul>
          </div>
          <p className="px-1 text-neutral-400">
            You are responsible for making sure you receive your eligibility or worker points. Requests count
            once they&apos;re approved. Rules: RMEC rulebook sections 5 and 9.
          </p>
        </aside>
      </div>
    </Page>
  );
}
