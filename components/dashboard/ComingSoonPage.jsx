/**
 * Placeholder page for a sidebar module the spec left un-specified (◇).
 *
 * The spec asks for "title, empty state, 'Coming soon'" and explicitly says
 * NOT to invent detailed behaviour for these. Each file below is a thin
 * wrapper so every nav entry resolves to a real route.
 */

import { EmptyState } from "@/components/ui/EmptyState";
import { Construction } from "lucide-react";

export default function ComingSoonPage({ title, description }) {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5">
        <h1 className="font-display text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-dim">{description}</p> : null}
      </header>
      <EmptyState
        icon={Construction}
        title="Not built yet"
        description={`${title} has a route and a place in the navigation, but nothing behind it yet.`}
      />
    </div>
  );
}