import { Suspense } from "react";
import { loadSeasonStandings } from "@/lib/standings-data";
import { ButtonLink, Page, PageHeader } from "@/components/ui";
import StandingsBoard from "../StandingsBoard";
import StandingsLoading from "../StandingsLoading";

async function JuniorStandings() {
  const { data, error } = await loadSeasonStandings("junior");

  if (error || !data) {
    return <p className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-red-200">{error}</p>;
  }
  if (data.classes.length === 0) {
    return <p className="text-neutral-400">No junior classes are set up for this season yet.</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
        {data.season.year} season · {data.eventCount} races · {data.classes.length} classes
      </p>
      <StandingsBoard
        classes={data.classes}
        divisions={[]}
        races={data.races}
        standingsByClass={data.byClass}
        standingsByDivision={{}}
        drops={data.drops}
        creditsLoaded={data.creditsLoaded}
      />
    </div>
  );
}

export default function JuniorStandingsPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Championship"
        title="Junior Standings"
        description="Current members ranked by class points earned this season, including races before they joined. Pick a race to see how everyone finished there."
        actions={
          <>
            <ButtonLink href="/" back variant="secondary">
              Home
            </ButtonLink>
            <ButtonLink href="/standings" variant="primary">
              Adult standings
            </ButtonLink>
          </>
        }
      />
      <Suspense fallback={<StandingsLoading />}>
        <JuniorStandings />
      </Suspense>
    </Page>
  );
}
