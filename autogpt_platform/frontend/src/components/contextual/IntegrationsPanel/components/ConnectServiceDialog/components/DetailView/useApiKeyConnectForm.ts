"use client";

import { useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetV1ListCredentialsQueryKey,
  postV1CreateCredentials,
} from "@/app/api/__generated__/endpoints/integrations/integrations";
import { toast } from "@/components/molecules/Toast/use-toast";

import { apiKeyConnectSchema, type ApiKeyConnectFormValues } from "./schema";

interface Args {
  provider: string;
  defaultTitle?: string;
  onSuccess: () => void;
}

type OAuthStatus = "idle" | "authorizing" | "success" | "error";

function toUnixSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return Math.floor(ms / 1000);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The AIMLAPI "Get API key" flow lives behind the frontend's server proxy,
// which forwards `/api/proxy/<path>` to the backend and injects auth.
async function postProxy<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export function useApiKeyConnectForm({ provider, defaultTitle, onSuccess }: Args) {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>("idle");
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);
  const authorizingRef = useRef(false);

  const form = useForm<ApiKeyConnectFormValues>({
    resolver: zodResolver(apiKeyConnectSchema),
    defaultValues: { title: defaultTitle ?? "", apiKey: "", expiresAt: "" },
    mode: "onChange",
  });

  async function getApiKey() {
    if (authorizingRef.current) return;
    authorizingRef.current = true;
    setOauthStatus("authorizing");
    setOauthMessage(null);

    // Open the consent tab synchronously so pop-up blockers allow it, then
    // point it at the verification URL once the backend returns one. Do NOT
    // pass `noopener` here: with it, window.open() returns null and we lose the
    // handle needed to redirect the tab — leaving a blank about:blank page.
    const consentWindow = window.open("about:blank", "_blank");

    try {
      const start = await postProxy<{
        request_id: string;
        verification_uri: string;
        interval: number;
        expires_in: number;
      }>("api/aimlapi/authorize/start", {});

      if (consentWindow) consentWindow.location.href = start.verification_uri;
      else window.open(start.verification_uri, "_blank");

      const intervalMs = Math.max(1, start.interval) * 1000;
      const deadline = Date.now() + Math.max(1, start.expires_in) * 1000;

      while (Date.now() < deadline) {
        await sleep(intervalMs);
        const poll = await postProxy<{ status: string; api_key: string | null }>(
          "api/aimlapi/authorize/poll",
          { request_id: start.request_id },
        );
        if (poll.status === "ready" && poll.api_key) {
          form.setValue("apiKey", poll.api_key, {
            shouldValidate: true,
            shouldDirty: true,
          });
          setOauthStatus("success");
          setOauthMessage("Your key has already been generated and added above.");
          return;
        }
        if (poll.status !== "pending" && poll.status !== "authorizing") {
          throw new Error("Sign-in failed. Please try again.");
        }
      }
      throw new Error("Sign-in timed out. Please try again.");
    } catch (error) {
      if (consentWindow && !consentWindow.closed) consentWindow.close();
      setOauthStatus("error");
      setOauthMessage(
        error instanceof Error ? error.message : "Sign-in failed. Please try again.",
      );
    } finally {
      authorizingRef.current = false;
    }
  }

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
