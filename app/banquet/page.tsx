import { ButtonLink, Page, PageHeader } from "@/components/ui";

export default function BanquetPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Year-end awards"
        title="Awards Banquet"
        description="Banquet sign-up is coming soon. Check back here for the date, location and tickets."
        actions={
          <>
            <ButtonLink href="/" back variant="secondary">
              Home
            </ButtonLink>
            <ButtonLink href="/standings" variant="primary">
              Standings
            </ButtonLink>
          </>
        }
      />
      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-8">
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-amber-300">Coming soon</p>
        <h2 className="mt-3 text-2xl font-black uppercase text-white">Sign-up opens soon</h2>
        <p className="mt-3 max-w-2xl text-neutral-300">
          The year-end banquet is where class and division awards, the AA top ten and the RMEC
          awards are presented. Sign-up details will be posted here.
        </p>
      </div>
    </Page>
  );
}
