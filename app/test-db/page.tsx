import { Suspense } from "react";
import { selectPublicRows } from "@/lib/supabase/data";

type EventRow = {
  id: string;
  name: string;
  race_date: string;
  location: string | null;
};

async function TestDatabaseContent() {
  const result = await selectPublicRows<EventRow>(
    "events",
    "id, name, race_date, location",
    {
      orderBy: "race_date",
      ascending: true,
      limit: 10,
    },
  );

  return (
    <main className="min-h-screen bg-[#101211] p-10 text-white">
      <h1 className="mb-6 text-3xl font-bold">Supabase Connection Test</h1>

      {result.error ? (
        <div className="rounded-lg border border-red-500 p-4">
          <h2 className="font-bold text-red-400">Connection error</h2>
          <p className="mt-2">{result.error.message}</p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-lime-400">
            Successfully retrieved {result.data?.length ?? 0} events.
          </p>

          <div className="space-y-3">
            {result.data?.map((event) => (
              <div
                key={event.id}
                className="rounded-lg border border-white/10 p-4"
              >
                <h2 className="font-bold">{event.name}</h2>
                <p className="text-neutral-400">{event.race_date}</p>
                {event.location && (
                  <p className="text-neutral-400">{event.location}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

export default function TestDatabasePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#101211] p-10 text-white">
          <h1 className="mb-6 text-3xl font-bold">Supabase Connection Test</h1>
          <p className="text-neutral-400">Loading database check...</p>
        </main>
      }
    >
      <TestDatabaseContent />
    </Suspense>
  );
}