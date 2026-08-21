"use client";

import { useRef, useState } from "react";

export type AimlapiOAuthStatus = "idle" | "authorizing" | "success" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const AIMLAPI_BASE_URL =
  process.env.NEXT_PUBLIC_AIMLAPI_API_URL?.replace(/\/$/, "") ||
  "https://api.aimlapi.com/v1";

// Attribution pair, required on EVERY aimlapi.com request — not just sign-up.
// The balance check below runs in the browser, so it cannot inherit the
// backend client's default headers and has to carry them itself. The partner
// id is valid on both staging and production, so it ships compiled in; the env
// override exists only for a staging-only test id. Mirrors
// backend/api/features/aimlapi/config.py.
const AIMLAPI_SOURCE = "agent/autogpt";
const AIMLAPI_PARTNER_ID =
  process.env.NEXT_PUBLIC_AIMLAPI_PARTNER_ID || "part_T70zDIEvQLKSMzMQ7asjdtKR";

function attributionHeaders(): Record<string, string> {
  return {
    "X-AIMLAPI-Source": AIMLAPI_SOURCE,
    "X-AIMLAPI-Partner-ID": AIMLAPI_PARTNER_ID,
  };
}

// Verify a manually-entered AIMLAPI key by calling the balance endpoint with it
// (CORS-enabled, so the browser can hit it directly — no backend needed). A bad
// key returns 401; anything else means the key authenticates. Returns false
// only when the key is definitively invalid; on a network error we can't tell,
// so return true (fail open) rather than block a legitimate save.
export async function validateAimlapiApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${AIMLAPI_BASE_URL}/billing/balance`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...attributionHeaders(),
      },
    });
    return res.status !== 401;
  } catch {
    return true;
  }
}

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

// Device-authorization ("Get API key") grant for AIMLAPI: open a consent tab,
// poll the backend, and hand the issued key to `onKey`. Shared by the settings
// Connect-service form and the in-builder "Add new API key" modal.
export function useAimlapiGetApiKey(onKey: (apiKey: string) => void) {
  const [oauthStatus, setOauthStatus] = useState<AimlapiOAuthStatus>("idle");
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);
  const authorizingRef = useRef(false);

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
          onKey(poll.api_key);
          setOauthStatus("success");
          setOauthMessage(
            "Your key has already been generated and added above.",
          );
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
        error instanceof Error
          ? error.message
          : "Sign-in failed. Please try again.",
      );
    } finally {
      authorizingRef.current = false;
    }
  }

  return { getApiKey, oauthStatus, oauthMessage };
}
