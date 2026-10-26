import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  BriefcaseBusiness,
  CalendarClock,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  ShieldOff,
} from "lucide-react-native";
import { Linking, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AppText } from "@/components/ui/app-text";
import { ErrorState, LoadingState, PageHeader, ScreenScroll } from "@/components/ui/screen";
import { apiRequest } from "@/lib/api";
import { formatDate, shiftWindow } from "@/lib/format";
import type { TeamMember } from "@/lib/types";

type EmployeeResponse = {
  employee: TeamMember & {
    email?: string | null;
    hire_date?: string | null;
    shift_label?: string;
    attendance_source?: string | null;
    created_at?: string;
  };
  geofenceIds: string[];
};

export default function TeamMemberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery({
    queryKey: ["team", "member", String(id)],
    queryFn: () => apiRequest<EmployeeResponse>(`/api/monitor/employees/${id}`),
    enabled: Boolean(id),
  });

  if (query.isLoading) return <LoadingState label="Loading team member" />;

  const employee = query.data?.employee;

  if (query.isError || !employee) {
    return (
      <ScreenScroll>
        <PageHeader title="Team member" back />
        <ErrorState
          title="Person unavailable"
          message="This employee record could not be loaded."
          onRetry={() => query.refetch()}
        />
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll>
      <PageHeader
        eyebrow="Employee"
        title={employee.name}
        back
        right={
          <Badge
            label={employee.status === "active" ? "Active" : "Inactive"}
            tone={employee.status === "active" ? "ok" : "neutral"}
            dot
          />
        }
      />

      <Card className="items-center p-6">
        <Avatar name={employee.name} uri={employee.photo_url} size={76} />
        <AppText className="mt-3 text-[18px] font-bold">{employee.name}</AppText>
        <AppText className="mt-1 text-[12px] text-faint">
          {employee.emp_code}
          {employee.designation_name ? ` · ${employee.designation_name}` : ""}
        </AppText>
        <View className="mt-4 flex-row gap-2">
          <Badge
            label={employee.tracking_consent ? "Tracking consent" : "No tracking consent"}
            tone={employee.tracking_consent ? "ok" : "warn"}
          />
          <Badge
            label={employee.geofencing_enabled ? "Geofencing on" : "Geofencing off"}
            tone={employee.geofencing_enabled ? "brand" : "neutral"}
          />
        </View>

        <View className="mt-5 w-full flex-row gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            disabled={!employee.phone}
            onPress={() => employee.phone && Linking.openURL(`tel:${employee.phone}`)}
            leftIcon={<Phone size={14} color="#E8F1FB" />}
          >
            Call
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            disabled={!employee.email}
            onPress={() => employee.email && Linking.openURL(`mailto:${employee.email}`)}
            leftIcon={<Mail size={14} color="#E8F1FB" />}
          >
            Email
          </Button>
        </View>
      </Card>

      <Card className="mt-3 gap-4 p-5">
        <Detail
          icon={<BriefcaseBusiness size={16} color="#8FA6C0" />}
          label="Department"
          value={employee.department_name || "Unassigned"}
        />
        <View className="h-px bg-line" />
        <Detail
          icon={<CalendarClock size={16} color="#8FA6C0" />}
          label="Shift"
          value={employee.shift_label || shiftWindow(employee.shift_start, employee.shift_end)}
        />
        <View className="h-px bg-line" />
        <Detail
          icon={<Phone size={16} color="#8FA6C0" />}
          label="Phone"
          value={employee.phone || "Not recorded"}
        />
        <View className="h-px bg-line" />
        <Detail
          icon={<Mail size={16} color="#8FA6C0" />}
          label="Email"
          value={employee.email || "Not recorded"}
        />
        <View className="h-px bg-line" />
        <Detail
          icon={
            employee.tracking_consent ? (
              <ShieldCheck size={16} color="#34D399" />
            ) : (
              <ShieldOff size={16} color="#FBBF24" />
            )
          }
          label="Location consent"
          value={employee.tracking_consent ? "Granted on device" : "Not granted"}
        />
        <View className="h-px bg-line" />
        <Detail
          icon={<MapPin size={16} color="#8FA6C0" />}
          label="Geofences"
          value={
            query.data?.geofenceIds?.length
              ? `${query.data.geofenceIds.length} assigned`
              : "None assigned"
          }
        />
      </Card>

      <Card className="mt-3 flex-row items-center justify-between">
        <View>
          <AppText variant="tiny">Attendance source</AppText>
          <AppText className="mt-1 text-[13px] font-medium">
            {(employee.attendance_source || "default").replace(/_/g, " ")}
          </AppText>
        </View>
        <View className="items-end">
          <AppText variant="tiny">Joined</AppText>
          <AppText className="mt-1 text-[13px] font-medium">
            {formatDate(employee.hire_date || employee.created_at, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </AppText>
        </View>
      </Card>
    </ScreenScroll>
  );
}

function Detail({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-raised">{icon}</View>
      <View className="flex-1">
        <AppText variant="tiny">{label}</AppText>
        <AppText className="mt-0.5 text-[13px] font-medium" numberOfLines={1}>
          {value}
        </AppText>
      </View>
    </View>
  );
}
