"""AIMLAPI endpoints + partner attribution for the "Get API key" flow.

Production values are compiled in; every value is overridable via an
``AIMLAPI_*`` environment variable, so the same build runs against staging by
changing only the endpoint/partner env. No staging URL is hard-coded.
"""

import os
from dataclasses import dataclass

# Provisioned AutoGPT partner — the same id is valid on staging and production,
# so it ships as the compiled-in default. Override with AIMLAPI_PARTNER_ID only
# for a staging-only test id.
DEFAULT_AIMLAPI_PARTNER_ID = "part_T70zDIEvQLKSMzMQ7asjdtKR"
DEFAULT_AIMLAPI_PARTNER_NAME = "AutoGPT"

# Client identifier reported on every AIMLAPI request (analytics + Mailchimp).
AIMLAPI_SOURCE = "agent/autogpt"
# Shown on the consent screen so the user sees which app is asking for a key.
AGENT_NAME = "AutoGPT"
# Spend cap presented on the consent screen, in USD minor units ($10).
DEFAULT_AIMLAPI_REQUESTED_USD_LIMIT_MINOR = 1000


def _env_or_default(name: str, default: str) -> str:
    value = (os.getenv(name) or "").strip()
    return value or default


@dataclass(frozen=True, slots=True)
class AimlapiEndpoints:
    app_base_url: str
    verification_base_url: str


def resolve_endpoints() -> AimlapiEndpoints:
    return AimlapiEndpoints(
        # Host of the device-authorization + token endpoints.
        app_base_url=_env_or_default(
            "AIMLAPI_APP_URL", "https://app.aimlapi.com"
        ).rstrip("/"),
        # Base of the browser consent page, which lives in the web app under
        # ``/app`` (the bare host is a static marketing site). The create
        # response returns a production URL even on staging, so the consent URL
        # is always rebuilt from this base (default = prod, override for
        # staging, e.g. https://staging.aimlapi.com/app).
        verification_base_url=_env_or_default(
            "AIMLAPI_VERIFICATION_BASE_URL", "https://aimlapi.com/app"
        ).rstrip("/"),
    )


def resolve_inference_base_url() -> str:
    # OpenAI-compatible inference base (same override the LLM transport uses),
    # used to verify an API key against ``/chat/completions``.
    return _env_or_default(
        "AIMLAPI_INFERENCE_URL", "https://api.aimlapi.com/v1"
    ).rstrip("/")


def resolve_partner_id() -> str:
    return _env_or_default("AIMLAPI_PARTNER_ID", DEFAULT_AIMLAPI_PARTNER_ID)


def resolve_partner_name() -> str:
    return _env_or_default("AIMLAPI_PARTNER_NAME", DEFAULT_AIMLAPI_PARTNER_NAME)


def resolve_requested_usd_limit_minor() -> int:
    raw = os.getenv("AIMLAPI_REQUESTED_USD_LIMIT_MINOR")
    if raw is None:
        return DEFAULT_AIMLAPI_REQUESTED_USD_LIMIT_MINOR
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_AIMLAPI_REQUESTED_USD_LIMIT_MINOR
    return value if value > 0 else DEFAULT_AIMLAPI_REQUESTED_USD_LIMIT_MINOR


def attribution_headers() -> dict[str, str]:
    """Headers that mark AIMLAPI traffic as agent-sourced for this partner."""
    return {
        "X-AIMLAPI-Source": AIMLAPI_SOURCE,
        "X-AIMLAPI-Partner-ID": resolve_partner_id(),
    }
