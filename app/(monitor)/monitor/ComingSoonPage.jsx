/**
 * Placeholder page for a sidebar module the spec left un-specified (◇).
 *
 * The spec asks for "title, empty state, 'Coming soon'" and explicitly says
 * NOT to invent detailed behaviour for these. Each file below is a thin
 * wrapper so every nav entry resolves to a real route.
 */

import { ComingSoon } from "@/components/monitor/states";

export default function ComingSoonPage({ title, description }) {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <div className="flex items-center gap-3">
          <span className="h-7 w-1.5 rounded-full bg-brand" aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold text-ink">{title}</h1>
            {description ? (
              <p className="mt-0.5 text-[13px] text-ink-dim">{description}</p>
            ) : null}
          </div>
        </div>
      </header>
      <ComingSoon label={title} />
    </div>
  );
}