export default function ResultsPageLoading() {
  return (
    <main className="min-h-screen bg-[#101211] text-white">
      <section className="mx-auto max-w-7xl animate-pulse px-6 py-16 md:py-20">
        <div className="h-4 w-56 rounded bg-white/10" />
        <div className="mt-4 h-12 w-72 rounded bg-white/10" />
        <div className="mt-5 h-5 max-w-2xl rounded bg-white/10" />
        <div className="mt-12 h-64 rounded-xl border border-white/10 bg-white/[0.03]" />
      </section>
    </main>
  );
}