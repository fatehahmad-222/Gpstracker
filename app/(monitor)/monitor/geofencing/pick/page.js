import { Suspense } from "react";
import dynamic from "next/dynamic";

import { Card } from "@/components/monitor/primitives";

/**
 * Standalone map for building a shape away from the list.
 *
 * Useful on a projector during a site survey, where drawing on a full-screen map
 * and saving the fence directly is quicker than working inside the list form.
 * Uses the same form, so validation and the saved geometry are identical.
 */
const FenceForm = dynamic(() => import("@/components/monitor/geofencing/FenceForm").then((m) => m.FenceForm), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-tile border border-line bg-surface-2 text-[12.5px] text-ink-dim">
      Loading map…
    </div>
  ),
});

export const metadata = { title: "Pick on Map" };

export default function Page() {
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
          <h1 className="text-[19px] font-semibold text-ink">Pick on Map</h1>
          <p className="text-[12.5px] text-ink-dim">
            Draw a location straight on the map. The shape is saved exactly as drawn.
          </p>
        </header>

        <FenceForm onCancel={() => window.history.back()} onSaved={() => window.history.back()} />

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