import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ChevronRight, Search, ShieldCheck, ShieldOff, UserRoundPlus, Users } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, PageHeader, ScreenScroll } from "@/components/ui/screen";
import { TextField } from "@/components/ui/text-field";
import { AppText } from "@/components/ui/app-text";
import { apiRequest } from "@/lib/api";
import { QUERY_KEYS } from "@/lib/constants";
import { shiftWindow } from "@/lib/format";
import type { TeamMember } from "@/lib/types";
import { useApp } from "@/providers/app-provider";

export default function TeamScreen() {
  const router = useRouter();
  const { isAdmin } = useApp();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: QUERY_KEYS.team(term),
    queryFn: () =>
      apiRequest<{ rows: TeamMember[]; total: number }>(
        `/api/monitor/employees?page_size=100${term ? `&q=${encodeURIComponent(term)}` : ""}`
      ),
    enabled: isAdmin,
    refetchInterval: 60_000,
  });

  const rows = query.data?.rows || [];
  const active = rows.filter((row) => row.status === "active").length;
  const consented = rows.filter((row) => row.tracking_consent).length;

  return (
    <ScreenScroll
      refreshing={query.isRefetching}
      onRefresh={() => query.refetch()}
    >
      <PageHeader
        eyebrow="People"
        title="Team"
        subtitle={`${rows.length} shown · ${active} active · ${consented} consented`}
        right={
          <View className="h-10 w-10 items-center justify-center rounded-2xl bg-brand/12">
            <Users size={19} color="#7CB4FF" />
          </View>
        }
      />

      <TextField
        value={search}
        onChangeText={setSearch}
        placeholder="Search name, code or phone"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        leftIcon={<Search size={17} color="#5E7693" />}
      />

      <View className="mt-4 gap-2.5">
        {query.isError ? (
          <ErrorState
            title="Could not load team"
            message="Check your connection and try again."
            onRetry={() => query.refetch()}
          />
        ) : query.isLoading ? (
          <Card className="items-center py-8">
            <AppText variant="small">Loading your team…</AppText>
          </Card>
        ) : rows.length ? (
          rows.map((member) => (
            <Pressable
              key={member.id}
              onPress={() =>
                router.push({ pathname: "/team/[id]", params: { id: member.id } })
              }
              className="flex-row items-center gap-3 rounded-3xl border border-line bg-surface p-3.5 active:opacity-80"
            >
              <Avatar name={member.name} uri={member.photo_url} size={44} />
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <AppText className="flex-1 font-semibold" numberOfLines={1}>
                    {member.name}
                  </AppText>
                  <Badge
                    label={member.status === "active" ? "Active" : "Inactive"}
                    tone={member.status === "active" ? "ok" : "neutral"}
                    dot
                  />
                </View>
                <AppText className="mt-0.5 text-[11px] text-faint" numberOfLines={1}>
                  {member.emp_code}
                  {member.department_name ? ` · ${member.department_name}` : ""}
                </AppText>
                <View className="mt-1.5 flex-row items-center gap-3">
                  <View className="flex-row items-center gap-1">
                    {member.tracking_consent ? (
                      <ShieldCheck size={11} color="#34D399" />
                    ) : (
                      <ShieldOff size={11} color="#5E7693" />
                    )}
                    <AppText className="text-[10px] text-faint">
                      {member.tracking_consent ? "Consent" : "No consent"}
                    </AppText>
                  </View>
                  <AppText className="text-[10px] text-faint">
                    {shiftWindow(member.shift_start, member.shift_end)}
                  </AppText>
                </View>
              </View>
              <ChevronRight size={17} color="#5E7693" />
            </Pressable>
          ))
        ) : (
          <EmptyState
            icon={<UserRoundPlus size={28} color="#5E7693" />}
            title={term ? "No matches" : "No employees yet"}
            message={
              term
                ? "Try a different name, employee code or phone number."
                : "Employees added in the console will appear here."
            }
          />
        )}
      </View>

      {!term && rows.length >= 100 ? (
        <AppText variant="tiny" className="mt-4 text-center leading-5">
          Showing the first 100 people. Search to narrow the list.
        </AppText>
      ) : null}
    </ScreenScroll>
  );
}
