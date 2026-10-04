"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";

import { Card } from "@/components/monitor/primitives";

/**
 * The interactive half of the "Pick on Map" screen.
 *
 * This lives apart from the page because that page exports `metadata`, which
 * only a Server Component may do -- and a Server Component cannot hand function
 * props to a Client Component. The original had both in one file, which only
 * escaped the build while the route sat behind a layout that forced every
 * request to be dynamic; under /dashboard it became a prerender and the build
 * failed on "Event handlers cannot be passed to Client Component props".
 *
 * Keeping the `ssr: false` dynamic import here also matters: that option is not
 * valid in a Server Component at all.
 */
const FenceForm = dynamic(
  () => import("@/components/monitor/geofencing/FenceForm").then((m) => m.FenceForm),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] items-center justify-center rounded-tile border border-line bg-surface-2 text-[12.5px] text-ink-dim">
        Loading map…
      </div>
    ),
  }
);

export function PickOnMapPanel() {
  const back = () => window.history.back();

  return (
    <Suspense
      fallback={
        <div className="flex h-[420px] items-center justify-center rounded-tile border border-line bg-surface-2 text-[12.5px] text-ink-dim">
          Loading map…
        </div>
      }
    >
      <div className="space-y-4">
        <header>
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
            Pick on Map
          </h1>
          <p className="mt-0.5 text-sm text-ink-dim">
            Draw a location straight on the map. The shape is saved exactly as drawn.
          </p>
        </header>

        <FenceForm onCancel={back} onSaved={back} />

        <Card title="While surveying" compact>
          <ul className="list-inside list-disc space-y-1 text-[12.5px] text-ink-dim">
            <li>One click sets a circle&apos;s centre; the radius is a number in metres.</li>
            <li>A rectangle takes two clicks: any corner, then the opposite one.</li>
            <li>A polygon takes one click per corner, at least three.</li>
            <li>A route takes the origin, any waypoints, then the destination.</li>
            <li>Distances are calculated for you and shown before you save.</li>
          </ul>
        </Card>
      </div>
    </Suspense>
  );
}