export default function StandingsLoading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-5 w-48 rounded bg-gray-200" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-11 rounded-lg bg-gray-200" />
        <div className="h-11 rounded-lg bg-gray-200" />
      </div>
      <div className="h-64 rounded-xl bg-gray-100" />
    </div>
  );
}
