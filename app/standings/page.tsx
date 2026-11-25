import { Suspense } from "react";
import { loadSeasonStandings } from "@/lib/standings-data";
import { ButtonLink, Page, PageHeader } from "@/components/ui";
import StandingsBoard from "./StandingsBoard";
import StandingsLoading from "./StandingsLoading";

async function AdultStandings() {
  const { data, error } = await loadSeasonStandings("adult");

  if (error || !data) {
    return <p className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-red-200">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
        {data.season.year} season · {data.eventCount} races · {data.memberCount} eligible riders
      </p>
      <StandingsBoard
        classes={data.classes}
        divisions={data.divisions}
        races={data.races}
        standingsByClass={data.byClass}
        standingsByDivision={data.byDivision}
      />
    </div>
  );
}

export default function StandingsPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Championship"
        title="Adult Standings"
        description="Current members ranked by points earned this season, including races before they joined. Pick a race to see how everyone finished there."
        actions={
          <>
            <ButtonLink href="/" back variant="secondary">
              Home
            </ButtonLink>
            <ButtonLink href="/standings/junior" variant="primary">
              Junior standings
            </ButtonLink>
          </>
        }
      />
      <Suspense fallback={<StandingsLoading />}>
        <AdultStandings />
      </Suspense>
    </Page>
  );
}
