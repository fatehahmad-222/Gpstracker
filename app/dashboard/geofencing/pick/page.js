import { PickOnMapPanel } from "@/components/monitor/geofencing/PickOnMapPanel";

/**
 * Standalone map for building a shape away from the list.
 *
 * Useful on a projector during a site survey, where drawing on a full-screen map
 * and saving the fence directly is quicker than working inside the list form.
 * Uses the same form, so validation and the saved geometry are identical.
 */
export const metadata = { title: "Pick on Map" };

export default function Page() {
  return <PickOnMapPanel />;
}