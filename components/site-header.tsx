import Link from "next/link";
import { site } from "@/lib/site";

export const NAV = [
  { href: "/", label: "Browse" },
  { href: "/about", label: "How entries are chosen" },
  { href: "/removal", label: "Removal and corrections" },
] as const;

const linkClass = "rounded px-2 py-1 text-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

export function SiteHeader() {
  return (
    <header className="border-b border-[color:var(--line)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          {site.name}
        </Link>
        {/* Wide screens: inline links. Narrow screens: a native disclosure that needs no JavaScript. */}
        <nav aria-label="Main" className="hidden gap-1 sm:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={linkClass}>
              {n.label}
            </Link>
          ))}
        </nav>
        <details className="relative sm:hidden">
          <summary className="cursor-pointer list-none rounded border border-[color:var(--line)] px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            Menu
          </summary>
          <nav aria-label="Main (mobile)" className="absolute right-0 z-10 mt-2 flex w-64 flex-col gap-1 rounded border border-[color:var(--line)] bg-[color:var(--background)] p-2 shadow">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={`${linkClass} py-2`}>
                {n.label}
              </Link>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
