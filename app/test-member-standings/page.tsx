import { selectPublicRows } from "@/lib/supabase/data";

type MemberRider = {
  id: string;
  full_name: string;
  rider_number: string | null;
};

export default async function TestMemberStandingsPage() {
  const { data, error } = await selectPublicRows<MemberRider>(
    "member_standings_riders",
    "id, full_name, rider_number",
    { limit: 10 },
  );

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold">Member Standings Test</h1>
        <p className="mt-4 text-red-600">
          Could not load riders: {error.message}
        </p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Member Standings Test</h1>

      <p className="mt-2">
        Successfully loaded {data?.length ?? 0} riders.
      </p>

      <ul className="mt-4 space-y-2">
        {(data ?? []).map((rider) => (
          <li key={rider.id}>
            {rider.full_name} — #{rider.rider_number ?? "N/A"}
          </li>
        ))}
      </ul>
    </main>
  );
}