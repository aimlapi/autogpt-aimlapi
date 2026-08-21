import type { ProviderMetadata } from "@/app/api/__generated__/models/providerMetadata";
import { ProviderMetadataSupportedAuthTypesItem as AuthType } from "@/app/api/__generated__/models/providerMetadataSupportedAuthTypesItem";

import { formatProviderName } from "../../helpers";

export type AuthMethod = (typeof AuthType)[keyof typeof AuthType];

export { AuthType };

// Providers surfaced first in the "Connect a service" list, marked "Recommended".
const RECOMMENDED_PROVIDERS: ReadonlySet<string> = new Set(["aiml_api"]);

export interface ConnectableProvider {
  id: string;
  name: string;
  description?: string | null;
  supportedAuthTypes: AuthMethod[];
  recommended?: boolean;
  authProviderByType?: Partial<Record<AuthMethod, string>>;
  searchTerms?: string[];
}

const KNOWN_AUTH_METHODS: ReadonlySet<AuthMethod> = new Set(
  Object.values(AuthType),
);

function normalizeAuthTypes(
  raw: readonly AuthMethod[] | undefined,
): AuthMethod[] {
  if (!raw) return [];
  return raw.filter((t) => KNOWN_AUTH_METHODS.has(t));
}

export function toConnectableProviders(
  metadata: ProviderMetadata[],
): ConnectableProvider[] {
  const seen = new Set<string>();
  const byDisplayProvider = new Map<string, ConnectableProvider>();
  for (const item of metadata) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);

    const displayProvider = item.name === "codex" ? "openai" : item.name;
    const authTypes = normalizeAuthTypes(item.supported_auth_types);
    const existing = byDisplayProvider.get(displayProvider);
    const provider = existing ?? {
      id: displayProvider,
      name: formatProviderName(displayProvider),
      description: item.description,
      supportedAuthTypes: [],
      // Spread rather than `recommended: false` so a non-recommended provider
      // carries no extra key — the shape stays exactly what callers assert on.
      ...(RECOMMENDED_PROVIDERS.has(displayProvider) ? { recommended: true } : {}),
    };

    for (const authType of authTypes) {
      const alreadySupported = provider.supportedAuthTypes.includes(authType);
      if (!alreadySupported) {
        provider.supportedAuthTypes.push(authType);
      }
      if (item.name === displayProvider) {
        delete provider.authProviderByType?.[authType];
      } else if (!alreadySupported) {
        provider.authProviderByType = {
          ...provider.authProviderByType,
          [authType]: item.name,
        };
      }
    }
    if (item.name !== displayProvider) {
      provider.searchTerms = Array.from(
        new Set([...(provider.searchTerms ?? []), item.name]),
      );
    }
    if (item.name === displayProvider) {
      provider.description = item.description;
    }
    byDisplayProvider.set(displayProvider, provider);
  }

  const openai = byDisplayProvider.get("openai");
  if (openai?.authProviderByType?.oauth2 === "codex") {
    openai.description =
      "OpenAI models via API key or your ChatGPT subscription";
  }

  const result = Array.from(byDisplayProvider.values());
  // Recommended providers first, then alphabetical.
  result.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

function normalize(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function filterConnectableProviders(
  providers: ConnectableProvider[],
  query: string,
): ConnectableProvider[] {
  const q = normalize(query.trim());
  if (!q) return providers;
  return providers.filter((p) => {
    if (normalize(p.name).includes(q)) return true;
    if (normalize(p.id).includes(q)) return true;
    if (p.searchTerms?.some((term) => normalize(term).includes(q))) return true;
    if (p.description && normalize(p.description).includes(q)) return true;
    return false;
  });
}
