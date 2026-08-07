"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetV1ListCredentialsQueryKey,
  postV1CreateCredentials,
} from "@/app/api/__generated__/endpoints/integrations/integrations";
import { toast } from "@/components/molecules/Toast/use-toast";
import { useAimlapiGetApiKey } from "@/hooks/useAimlapiGetApiKey";

import { apiKeyConnectSchema, type ApiKeyConnectFormValues } from "./schema";

interface Args {
  provider: string;
  defaultTitle?: string;
  onSuccess: () => void;
}

function toUnixSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return Math.floor(ms / 1000);
}

export function useApiKeyConnectForm({ provider, defaultTitle, onSuccess }: Args) {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<ApiKeyConnectFormValues>({
    resolver: zodResolver(apiKeyConnectSchema),
    defaultValues: { title: defaultTitle ?? "", apiKey: "", expiresAt: "" },
    mode: "onChange",
  });

  const { getApiKey, oauthStatus, oauthMessage } = useAimlapiGetApiKey((key) =>
    form.setValue("apiKey", key, { shouldValidate: true, shouldDirty: true }),
  );

  async function handleSubmit(values: ApiKeyConnectFormValues) {
    setIsPending(true);
    try {
      // customMutator throws on non-2xx, so reaching this line means success.
      await postV1CreateCredentials(provider, {
        provider,
        type: "api_key",
        title: values.title,
        api_key: values.apiKey,
        expires_at: toUnixSeconds(values.expiresAt),
      });

      toast({ title: "API key saved", variant: "success" });
      await queryClient.invalidateQueries({
        queryKey: getGetV1ListCredentialsQueryKey(),
      });
      onSuccess();
    } catch (error) {
      toast({
        title: "Couldn't save API key",
        description:
          error instanceof Error ? error.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  }

  return {
    form,
    handleSubmit,
    isPending,
    getApiKey,
    oauthStatus,
    oauthMessage,
  };
}
