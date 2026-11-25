import Link from "next/link";
import { Suspense } from "react";
import { selectPublicRows } from "@/lib/supabase/data";
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
  return <p className="text-gray-500">Loading riders...</p>;
}

export default function RidersPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Home
      </Link>

      <h1 className="mt-4 text-3xl font-bold">Rider Stats</h1>

      <p className="mt-2 text-gray-600">
        Search riders to explore their race history and statistics.
      </p>

      <Suspense fallback={<RidersLoading />}>
        <RidersContent />
      </Suspense>
    </main>
  );
}

async function RidersContent() {
  const result = await selectPublicRows<Rider>("public_riders", "id, full_name, rider_number", {
    orderBy: "full_name",
    ascending: true,
  });

  if (result.error || !Array.isArray(result.data)) {
    return <p className="mt-4 text-red-600">Unable to load riders. Please try again later.</p>;
  }

  return <RiderSearch riders={result.data} />;
}
