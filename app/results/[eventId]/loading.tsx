export default function EventResultsLoading() {
  return (
    <main className="w-full flex-1 bg-[#101211] text-white">
      <section className="mx-auto max-w-7xl animate-pulse px-6 py-16 md:py-20">
        <div className="h-4 w-32 rounded bg-white/10" />
        <div className="mt-10 h-12 max-w-xl rounded bg-white/10" />
        <div className="mt-4 h-5 w-64 rounded bg-white/10" />
        <div className="mt-10 h-72 rounded-xl border border-white/10 bg-white/[0.03]" />
      </section>
    </main>
  );
}