"use client";

import Link from "next/link";

// Shown when a page fails to load data. The message is generic on purpose: no internal detail is shown to visitors.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-2xl" role="alert">
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="mt-3">The directory could not load this page. Please try again in a moment.</p>
      <p className="mt-3 flex gap-4">
        <button type="button" onClick={() => reset()} className="rounded border border-[color:var(--line)] px-3 py-1">
          Try again
        </button>
        <Link href="/" className="underline">Browse the directory</Link>
      </p>
    </div>
  );
}
