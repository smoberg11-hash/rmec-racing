export default function StandingsLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-label="Loading standings">
      <div className="flex gap-2">
        <div className="h-10 w-28 rounded-full bg-white/10" />
        <div className="h-10 w-28 rounded-full bg-white/[0.06]" />
        <div className="h-10 w-28 rounded-full bg-white/[0.06]" />
      </div>
      <div className="h-24 rounded-2xl border border-white/10 bg-white/[0.03]" />
      <div className="h-96 rounded-2xl border border-white/10 bg-white/[0.03]" />
    </div>
  );
}
