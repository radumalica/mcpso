import Link from "next/link";

export default function NotFound() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="mt-3">There is no entry or page at this address. It may never have existed, or it may have been removed.</p>
      <p className="mt-3">
        <Link href="/" className="underline">Browse the directory</Link>
      </p>
    </div>
  );
}
