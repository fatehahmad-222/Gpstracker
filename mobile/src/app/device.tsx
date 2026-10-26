import { Fingerprint, ShieldCheck, Smartphone } from "lucide-react-native";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, ScreenScroll } from "@/components/ui/screen";
import { formatDate, timeAgo } from "@/lib/format";
import { useApp } from "@/providers/app-provider";

export default function DevicesScreen() {
  const { bootstrap } = useApp();
  const devices = bootstrap?.enrollment.devices || [];
  const revoked = bootstrap?.enrollment.revoked_device;

  return (
    <ScreenScroll>
      <PageHeader
        eyebrow="Security"
        title="Enrolled devices"
        subtitle="Phones allowed to send field data for this account."
        back
      />

      {revoked ? (
        <Card className="mb-3 border-danger/25 bg-danger/[0.05]">
          <View className="flex-row items-start gap-3">
            <Smartphone size={18} color="#FB7185" />
            <View className="flex-1">
              <AppText className="font-semibold text-danger">A device was revoked</AppText>
              <AppText variant="small" className="mt-1">
                Revoked {formatDate(revoked.revoked_at, { month: "short", day: "numeric" })}.
                {revoked.can_reenroll
                  ? " Re-enrollment is allowed by an administrator."
                  : " Ask an administrator if you need a replacement phone enrolled."}
              </AppText>
            </View>
          </View>
        </Card>
      ) : null}

      {devices.length ? (
        <View className="gap-2.5">
          {devices.map((device) => (
            <Card key={device.id} className="flex-row items-center gap-3.5 p-4">
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand/10">
                <Smartphone size={19} color="#7CB4FF" />
              </View>
              <View className="flex-1">
                <AppText className="text-[13px] font-semibold">
                  {device.label || "Field phone"}
                </AppText>
                <AppText className="mt-0.5 text-[10px] text-faint">
                  Added {formatDate(device.created_at, { month: "short", day: "numeric", year: "numeric" })}
                  {device.last_used_at ? ` · used ${timeAgo(device.last_used_at).toLowerCase()}` : ""}
                </AppText>
              </View>
              <Badge label="Active" tone="ok" dot />
            </Card>
          ))}
        </View>
      ) : (
        <EmptyState
          icon={<Fingerprint size={28} color="#5E7693" />}
          title="No enrolled device"
          message="This account has no active field phone. Complete enrollment to begin."
        />
      )}

      <Card className="mt-4 border-cyan/20 bg-cyan/[0.04]">
        <View className="flex-row gap-3">
          <ShieldCheck size={18} color="#22D3EE" />
          <AppText variant="small" className="flex-1">
            Each phone holds its own encrypted device credential. Revoking one
            device does not affect another, and location data cannot be uploaded
            without that credential.
          </AppText>
        </View>
      </Card>
    </ScreenScroll>
  );
}
