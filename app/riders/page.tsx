import Link from "next/link";
import { Suspense } from "react";
import { selectPublicRows } from "@/lib/supabase/data";

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
  return <p className="p-8 text-gray-500">Loading riders...</p>;
}

export default function RidersPage() {
  return (
    <Suspense fallback={<RidersLoading />}>
      <RidersContent />
    </Suspense>
  );
}

async function RidersContent() {
  const result = await selectPublicRows<Rider>(
    "public_riders",
    "id, full_name, rider_number",
    {
      orderBy: "full_name",
      ascending: true,
    }
  );

  if (result.error || !Array.isArray(result.data)) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-3xl font-bold">Rider Stats</h1>
        <p className="mt-4 text-red-600">
          Unable to load riders. Please try again later.
        </p>
      </main>
    );
  }

  return <RidersSearchPage riders={result.data} />;
}

function RidersSearchPage({ riders }: { riders: Rider[] }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Home
      </Link>

      <h1 className="mt-4 text-3xl font-bold">Rider Stats</h1>

      <p className="mt-2 text-gray-600">
        Search riders to explore their race history and statistics.
      </p>

      <form action="/riders" method="GET" className="my-6 flex gap-2">
        <input
          type="search"
          name="search"
          placeholder="Search by rider name or number..."
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-4 py-3"
        />

        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-700"
        >
          Search
        </button>
      </form>

      <RiderList riders={riders} />
    </main>
  );
}

function RiderList({ riders }: { riders: Rider[] }) {
  return (
    <>
      <p className="mb-4 text-sm text-gray-500">
        {riders.length} rider{riders.length === 1 ? "" : "s"}
      </p>

      {riders.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-gray-500">
          No riders found.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {riders.map((rider) => (
            <Link
              key={rider.id}
              href={`/riders/${rider.id}`}
              className="flex items-center justify-between gap-4 border-b p-4 last:border-b-0 hover:bg-gray-50"
            >
              <div>
                <h2 className="font-semibold">
                  {rider.full_name || "Unknown Rider"}
                </h2>

                {rider.rider_number != null && (
                  <p className="mt-1 text-sm text-gray-500">
                    Rider #{rider.rider_number}
                  </p>
                )}
              </div>

              <span className="text-sm font-medium text-blue-600">
                View Stats →
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}