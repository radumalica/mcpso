import { MAX_SEARCH_TERM_LENGTH } from "@/utils/search-term";

// A plain GET form: works without JavaScript, supports Enter and IME input, and is never disabled.
export function SearchForm({ q, declared }: { q?: string; declared?: boolean }) {
  return (
    <form role="search" aria-label="Search the directory" method="get" action="/" className="flex flex-col gap-3">
      <div className="flex gap-2">
        <label htmlFor="q" className="sr-only">Search by name or description</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q ?? ""}
          maxLength={MAX_SEARCH_TERM_LENGTH}
          placeholder="Search by name or description"
          className="min-w-0 flex-1 rounded border border-[color:var(--line)] bg-transparent px-3 py-2 text-base"
        />
        <button type="submit" className="rounded bg-[color:var(--accent)] px-4 py-2 text-base font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          Search
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="declared" value="1" defaultChecked={declared} />
        Include entries that are declared only (nothing about them has been checked)
      </label>
    </form>
  );
}
