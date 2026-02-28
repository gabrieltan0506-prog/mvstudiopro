import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
  autoFetch?: boolean;
};

export function useAuth(options?: UseAuthOptions) {
  const {
    redirectOnUnauthenticated = false,
    redirectPath = getLoginUrl(),
    autoFetch = true,
  } = options ?? {};
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();

  const apiMeQuery = useQuery({
    queryKey: ["api-me"],
    queryFn: async () => {
      const res = await fetch("/api/me", {
        method: "GET",
        credentials: "include",
      });

      if (res.status === 401) return null;
      if (!res.ok) {
        throw new Error(`Failed to fetch /api/me: ${res.status}`);
      }

      return (await res.json()) as {
        id: number;
        email: string | null;
        role: string;
        credits: number;
        verifyStatus: "none" | "pending" | "approved" | "rejected";
        roleTag: "normal" | "student" | "teacher" | "military_police";
        contactWechat?: string | null;
        contactPhone?: string | null;
      };
    },
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: autoFetch,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    enabled: autoFetch,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
      queryClient.setQueryData(["api-me"], null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      queryClient.setQueryData(["api-me"], null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, queryClient, utils]);

  const state = useMemo(() => {
    const trpcUser = meQuery.data ?? null;
    const apiMeUser = apiMeQuery.data
      ? {
          ...apiMeQuery.data,
          openId: trpcUser?.openId ?? `email_${apiMeQuery.data.email ?? "user"}`,
          name: trpcUser?.name ?? apiMeQuery.data.email ?? "用户",
          loginMethod: trpcUser?.loginMethod ?? "email_otp",
          createdAt: trpcUser?.createdAt ?? new Date(),
          updatedAt: trpcUser?.updatedAt ?? new Date(),
          lastSignedIn: trpcUser?.lastSignedIn ?? new Date(),
        }
      : null;
    const user = trpcUser
      ? {
          ...trpcUser,
          ...(apiMeQuery.data ?? {}),
        }
      : apiMeUser;

    localStorage.setItem(
      "manus-runtime-user-info",
      JSON.stringify(user)
    );

    return {
      user,
      loading:
        meQuery.isPending || apiMeQuery.isPending || logoutMutation.isPending,
      error: apiMeQuery.error ?? meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(user),
    };
  }, [
    apiMeQuery.data,
    apiMeQuery.error,
    apiMeQuery.isPending,
    meQuery.data,
    meQuery.error,
    meQuery.isPending,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isPending || apiMeQuery.isPending || logoutMutation.isPending) {
      return;
    }
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    apiMeQuery.isPending,
    logoutMutation.isPending,
    meQuery.isPending,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
