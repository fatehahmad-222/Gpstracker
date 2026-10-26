import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { CalendarPlus, Check } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, ScreenScroll } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { TextField } from "@/components/ui/text-field";
import { ApiError, apiRequest, errorMessage } from "@/lib/api";
import { companyToday } from "@/lib/format";
import type { Leave } from "@/lib/types";
import { useApp } from "@/providers/app-provider";

const types = [
  { key: "casual", label: "Casual" },
  { key: "sick", label: "Sick" },
  { key: "annual", label: "Annual" },
];

function dayCount(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return 0;
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export default function NewLeaveScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { bootstrap } = useApp();
  const today = companyToday(bootstrap?.company.timezone);

  const [type, setType] = useState("casual");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const days = dayCount(from, to);

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest<{ row: Leave; days: number }>("/api/monitor/leaves", {
        method: "POST",
        body: {
          employee_id: bootstrap?.employee?.id,
          leave_type: type,
          from_date: from,
          to_date: to,
          reason,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["leaves"] });
      router.replace("/(tabs)/leave");
    },
    onError: (err) => {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.fields) setFields(err.fields);
    },
  });

  const submit = () => {
    setError(null);
    const nextFields: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) nextFields.from_date = "Use YYYY-MM-DD";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) nextFields.to_date = "Use YYYY-MM-DD";
    if (from && to && to < from) nextFields.to_date = "End date cannot be before the start date";
    if (reason.length > 500) nextFields.reason = "Keep the reason under 500 characters";
    setFields(nextFields);
    if (Object.keys(nextFields).length) return;
    mutation.mutate();
  };

  return (
    <ScreenScroll>
      <PageHeader
        eyebrow="Time off"
        title="Request leave"
        subtitle="Your administrator will review this request."
        back
      />

      <Card className="gap-5 p-5">
        <View>
          <AppText variant="label" className="mb-2">Leave type</AppText>
          <Segmented options={types} value={type} onChange={setType} scroll={false} />
        </View>

        <View className="flex-row gap-3">
          <TextField
            label="From"
            value={from}
            onChangeText={(value) => {
              setFrom(value);
              setFields((current) => ({ ...current, from_date: "" }));
            }}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            error={fields.from_date}
            className="flex-1"
          />
          <TextField
            label="To"
            value={to}
            onChangeText={(value) => {
              setTo(value);
              setFields((current) => ({ ...current, to_date: "" }));
            }}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            error={fields.to_date}
            className="flex-1"
          />
        </View>

        <View className="flex-row items-center justify-between rounded-2xl border border-line bg-canvas px-4 py-3">
          <View className="flex-row items-center gap-2.5">
            <CalendarPlus size={16} color="#7CB4FF" />
            <AppText className="text-[13px] text-dim">Duration</AppText>
          </View>
          <AppText className="text-[13px] font-semibold">
            {days ? `${days} day${days === 1 ? "" : "s"}` : "—"}
          </AppText>
        </View>

        <TextField
          label="Reason (optional)"
          value={reason}
          onChangeText={(value) => {
            setReason(value);
            setFields((current) => ({ ...current, reason: "" }));
          }}
          placeholder="Add context for your administrator"
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          className="min-h-28"
          style={{ minHeight: 96 }}
          error={fields.reason}
        />

        {error ? (
          <View className="rounded-xl border border-danger/25 bg-danger/[0.06] p-3">
            <AppText className="text-[12px] leading-5 text-danger">{error}</AppText>
          </View>
        ) : null}

        <Button
          size="lg"
          loading={mutation.isPending}
          onPress={submit}
          leftIcon={<Check size={17} color="#FFFFFF" />}
        >
          Submit request
        </Button>
      </Card>

      <AppText variant="tiny" className="mt-4 text-center leading-5">
        Pending requests do not block your shift. You will see the decision here.
      </AppText>
    </ScreenScroll>
  );
}
