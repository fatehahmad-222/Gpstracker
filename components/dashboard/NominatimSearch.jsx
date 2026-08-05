"use client";

import { useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { NOMINATIM_ENDPOINT } from "@/lib/constants";

/**
 * Client-side OpenStreetMap Nominatim address search.
 * NOTE: Nominatim's free usage policy caps at ~1 request/sec with a valid
 * Referer/User-Agent. We debounce, limit results to 5, and only query after
 * 3 characters — see README for policy notes.
 */
export default function NominatimSearch({ onPick, placeholder, className }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  async function runSearch(q) {
    if (!q || q.trim().length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    setSearching(true);
    try {
      const url = `${NOMINATIM_ENDPOINT}?format=jsonv2&limit=5&accept-language=en&q=${encodeURIComponent(
        q.trim()
      )}`;
      const res = await fetch(url, {
        headers: { accept: "application/json", "accept-language": "en" },
      });
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
      setOpen(true);
    } catch {
      setResults([]);
      setOpen(false);
    } finally {
      setSearching(false);
    }
  }

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runSearch(q), 600);
  }

  function pick(result) {
    onPick({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      address: result.display_name,
    });
    setOpen(false);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
        <input
          value={query}
          onChange={handleChange}
          placeholder={placeholder ?? "Search an address or place…"}
          className="w-full rounded-field border border-line bg-bg py-2.5 pl-9 pr-9 text-sm text-ink placeholder:text-ink-dim/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        {searching && (
          <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink-dim" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1.5 max-h-64 w-full overflow-y-auto rounded-field border border-line bg-surface shadow-pop">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => pick(r)}
              className="flex w-full items-start gap-2.5 border-b border-line px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-2"
            >
              <MapPin size={14} className="mt-0.5 shrink-0 text-accent" />
              <span className="text-sm text-ink">{r.display_name}</span>
            </button>
          ))}
        </div>
      )}

      {open && results.length === 0 && !searching && (
        <div className="absolute z-20 mt-1.5 w-full rounded-field border border-line bg-surface px-3 py-2.5 text-sm text-ink-dim shadow-pop">
          No results found.
        </div>
      )}
    </div>
  );
}
