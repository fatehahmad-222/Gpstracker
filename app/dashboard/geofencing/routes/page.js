import { FenceManager } from "@/components/monitor/geofencing/FenceManager";

export const metadata = { title: "Routes" };

export default function Page() {
  return (
    <FenceManager
      lockedType="route"
      title="Routes"
      description="Origin to destination corridors, with the tolerated distance either side of the line."
    />
  );
}