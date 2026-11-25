import { Suspense } from "react";
import { selectPublicRows } from "@/lib/supabase/data";
import { ButtonLink, Page, PageHeader } from "@/components/ui";
import RiderSearch from "./RiderSearch";

export const metadata = {
  title: "Rider Stats | RMEC Racing",
  description: "Search RMEC Racing riders and view their statistics.",
};

type Rider = {
  id: string;
  full_name: string | null;
  rider_number: string | number | null;
};

function RidersLoading() {
  return <div className="h-16 animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />;
}

export default function RidersPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Riders"
        title="Rider Stats"
        description="Start typing a name or number to find a rider, then open their race history and season stats."
        actions={
          <ButtonLink href="/" back>
            Home
          </ButtonLink>
        }
      />
      <Suspense fallback={<RidersLoading />}>
        <RidersContent />
      </Suspense>
    </Page>
  );
}

async function RidersContent() {
  const result = await selectPublicRows<Rider>("public_riders", "id, full_name, rider_number", {
    orderBy: "full_name",
    ascending: true,
  });

  if (result.error || !Array.isArray(result.data)) {
    return <p className="text-red-300">Unable to load riders. Please try again later.</p>;
  }

  return <RiderSearch riders={result.data} />;
}
