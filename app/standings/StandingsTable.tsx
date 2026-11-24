import type { Standing } from "@/lib/standings";

export default function StandingsTable({
  title,
  description,
  standings,
  showEvents = true,
}: {
  title: string;
  description: string;
  standings: Standing[];
  showEvents?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="border-b bg-gray-50 px-4 py-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-gray-600">{description}</p>
      </div>

      {standings.length === 0 ? (
        <p className="p-6 text-gray-600">
          No standings are available for this selection yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-gray-600">
              <tr>
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Rider</th>
                <th className="px-4 py-3">Number</th>
                {showEvents && <th className="px-4 py-3 text-right">Events</th>}
                <th className="px-4 py-3 text-right">Wins</th>
                <th className="px-4 py-3 text-right">Points</th>
              </tr>
            </thead>

            <tbody>
              {standings.map((standing, index) => {
                const tied =
                  standings[index - 1]?.rank === standing.rank ||
                  standings[index + 1]?.rank === standing.rank;
                return (
                  <tr key={standing.riderId} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      {tied ? `T${standing.rank}` : standing.rank}
                    </td>
                    <td className="px-4 py-3 font-medium">{standing.riderName}</td>
                    <td className="px-4 py-3">{standing.riderNumber ?? "—"}</td>
                    {showEvents && (
                      <td className="px-4 py-3 text-right">{standing.events}</td>
                    )}
                    <td className="px-4 py-3 text-right">{standing.wins}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {standing.points}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
