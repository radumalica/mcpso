"use client";

import { ChangeEvent, FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  query?: string;
}

export default ({ query }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [content, setContent] = useState(query ?? "");

  useEffect(() => {
    setContent(query ?? "");
  }, [query]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setContent(e.target.value);
  };

  // A native form submit handles Enter (including IME composition) and the button; the input is never disabled.
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const term = content.trim();
    const url = term ? `?q=${encodeURIComponent(term)}` : "?";
    startTransition(() => {
      router.push(url);
    });
  };

  return (
    <section className="relative mt-4 md:mt-8">
      <div className="mx-auto w-full max-w-2xl px-6 text-center">
        <form
          role="search"
          aria-label="Search servers"
          onSubmit={handleSubmit}
          className="flex items-center relative"
        >
          <input
            type="search"
            name="q"
            aria-label="Search servers by keyword"
            className="text-sm md:text-md flex-1 px-4 py-3 pr-12 border-2 border-primary bg-white rounded-lg"
            placeholder="keyword to search"
            value={content}
            maxLength={200}
            onChange={handleInputChange}
          />
          <button
            type="submit"
            aria-label="Search"
            aria-busy={isPending}
            className="absolute right-3 p-2 cursor-pointer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
        </form>
      </div>
    </section>
  );
};
