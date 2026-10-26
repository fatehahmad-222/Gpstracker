export type PermissionState = {
  foreground: boolean;
  background: boolean;
  canAskAgain: boolean;
};

const unavailable: PermissionState = {
  foreground: false,
  background: false,
  canAskAgain: false,
};

export async function locationPermissionState() {
  return unavailable;
}

export async function requestLocationPermissions() {
  return unavailable;
}

export async function startBackgroundTracking(_options: {
  intervalMs: number;
  distanceM: number;
}) {
  return { ok: false as const, reason: "web_unsupported" };
}

export async function stopBackgroundTracking() {}

export async function trackingIsRunning() {
  return false;
}

export async function currentPosition() {
  return null;
}
