import { Suspense } from "react";
import { ButtonLink, Page, PageHeader } from "@/components/ui";
import { MEMBERSHIP_PLANS, membershipProvider } from "@/lib/membership";
import { selectPublicRows } from "@/lib/supabase/data";
import JoinForm, { type JoinRider } from "./JoinForm";

type Season = { id: string; year: number };
type Rider = { id: string; full_name: string; rider_number: string | null };
type EventRow = { id: string };
type ResultRow = { rider_id: string; class_id: string };
type ClassRow = { id: string; name: string };

async function JoinSection() {
  const provider = membershipProvider();
  const [seasonsRes, ridersRes, classesRes] = await Promise.all([
    selectPublicRows<Season>("seasons", "id, year", { orderBy: "year", ascending: false }),
    selectPublicRows<Rider>("public_riders", "id, full_name, rider_number"),
    selectPublicRows<ClassRow>("classes", "id, name"),
  ]);
  const season = seasonsRes.data?.[0];
  const eventsRes = season
    ? await selectPublicRows<EventRow>("events", "id", { equals: { column: "season_id", value: season.id } })
    : { data: [] as EventRow[] };
  const resultsRes = await selectPublicRows<ResultRow>("results", "rider_id, class_id", {
    in: { column: "event_id", values: (eventsRes.data ?? []).map((e) => e.id) },
  });
  const className = new Map((classesRes.data ?? []).map((c) => [c.id, c.name]));
  const classesByRider = new Map<string, Set<string>>();
  for (const r of resultsRes.data ?? []) {
    const name = className.get(r.class_id);
    if (!name) continue;
    if (!classesByRider.has(r.rider_id)) classesByRider.set(r.rider_id, new Set());
    classesByRider.get(r.rider_id)!.add(name);
  }
  const riders: JoinRider[] = (ridersRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.full_name,
    number: r.rider_number,
    classes: [...(classesByRider.get(r.id) ?? [])].join(", "),
  }));
  return <JoinForm plans={MEMBERSHIP_PLANS} provider={provider} riders={riders} />;
}

export default function JoinPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Membership"
        title="Join RMEC"
        description="An annual RMEC membership is needed to be ranked in the standings and for year-end awards. Memberships run to December 31."
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
              Loading…
            </div>
          }
        >
          <JoinSection />
        </Suspense>
        <aside className="space-y-4 text-sm leading-6 text-neutral-300">
          <div className="rounded-2xl border border-white/10 bg-[#141816] p-6">
            <h2 className="text-lg font-black uppercase text-white">What membership gets you</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>Ranked in the RMEC class and division standings (every race you rode this season counts).</li>
              <li>Eligible for year-end awards, with 4+ races and worker points or eligibility (rulebook 7.7–7.9).</li>
              <li>Must be bought before the last race of the year.</li>
            </ul>
          </div>
          <p className="px-1 text-neutral-400">
            Payment is handled by a secure payment provider; RMEC never sees your card number.
          </p>
        </aside>
      </div>
    </Page>
  );
}
