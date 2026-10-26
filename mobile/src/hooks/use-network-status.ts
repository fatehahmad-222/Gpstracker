import * as Network from "expo-network";
import { useEffect, useState } from "react";

export function useNetworkStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        if (mounted) setOnline(state.isConnected !== false);
      } catch {
        if (mounted) setOnline(true);
      }
    };

    check();
    const timer = setInterval(check, 20_000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  return online;
}
