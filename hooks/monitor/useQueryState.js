"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * URL-backed filter state.
 *
 * Spec 7: "All filters reflected in the URL query string so views are
 * shareable and back/forward works." Built on the router the project already
 * uses for the login and map pages — no new state library.
 */
export function useQueryState(defaults = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const values = useMemo(() => {
    const out = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const raw = searchParams?.get?.(key);
      if (raw != null && raw !== "") out[key] = raw;
    }
    return out;
    // `defaults` is spread into the memo on purpose; callers pass literals.
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const setParam = useCallback(
    (key, value) => {
      const params = new URLSearchParams(searchParams?.toString?.() || "");

      if (value == null || value === "" || value === defaults[key]) {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }

      const qs = params.toString();
      // `replace` for filter tweaks so Back returns to the previous page
      // rather than walking through every filter change.
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [searchParams, router, pathname, defaults]
  );

  const setMany = useCallback(
    (patch, { replace = true } = {}) => {
      const params = new URLSearchParams(searchParams?.toString?.() || "");
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === "" || value === defaults[key]) params.delete(key);
        else params.set(key, String(value));
      }
      const qs = params.toString();
      const target = qs ? `${pathname}?${qs}` : pathname;
      if (replace) router.replace(target, { scroll: false });
      else router.push(target, { scroll: false });
    },
    [searchParams, router, pathname, defaults]
  );

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const toggle = useCallback(
    (key, value) => {
      setParam(key, values[key] === value ? "" : value);
    },
    [setParam, values]
  );

  return { values, params: searchParams, setParam, setMany, reset, toggle };
}