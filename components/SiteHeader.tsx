import Image from "next/image";
import Link from "next/link";

const links = [
  { label: "Home", href: "/" },
  { label: "Race Results", href: "/results" },
  { label: "Rider Stats", href: "/riders" },
  { label: "Adult Standings", href: "/standings" },
  { label: "Junior Standings", href: "/standings/junior" },
];

export default function SiteHeader() {
  return (
    <header className="border-b border-white/10 bg-[#101211] text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5 px-6 py-5">
        <Link href="/" className="flex items-center gap-3 text-2xl font-black tracking-tight">
          <Image
            src="/rmec-logo.webp"
            alt="Rocky Mountain Enduro Circuit"
            width={160}
            height={160}
            priority
            className="h-12 w-12"
          />
          <span>
            RMEC<span className="text-lime-400">.</span>
          </span>
        </Link>

        <nav className="flex flex-wrap gap-5 text-sm font-medium text-neutral-300">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition hover:text-lime-400"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}