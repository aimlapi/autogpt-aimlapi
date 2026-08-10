"""AIMLAPI "Get API key" via OAuth 2.0 Device Authorization Grant (RFC 8628).

The app creates an authorization request, the user approves it on the aimlapi
consent page in the browser, and the app polls a token endpoint until the
issued API key comes back. The device code and the issued key stay server-side
— the browser only opens the consent URL, so no redirect URI or loopback
listener is needed (this is what makes the flow safe for arbitrary self-hosted
origins).
"""

import time
from dataclasses import dataclass
from urllib.parse import urlencode, urlparse, urlunparse

import httpx

from backend.api.features.aimlapi.config import (
    AGENT_NAME,
    attribution_headers,
    resolve_endpoints,
    resolve_inference_base_url,
    resolve_partner_id,
    resolve_partner_name,
    resolve_requested_usd_limit_minor,
)

DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
HTTP_TIMEOUT_SECONDS = 15.0
# Terminal, non-recoverable outcomes reported by the token endpoint.
TERMINAL_FAILURE_STATUSES = {
    "cancelled",
    "canceled",
    "denied",
    "error",
    "expired",
    "failed",
    "rejected",
}


class AimlapiAuthError(RuntimeError):
    """A safe, user-presentable failure of the AIMLAPI authorization flow."""


@dataclass(frozen=True, slots=True)
class AuthorizationRequest:
    request_id: str
    device_code: str
    verification_uri: str
    interval: int
    expires_at: float


@dataclass(frozen=True, slots=True)
class AuthorizationPollResult:
    status: str
    api_key: str = ""


def _positive_int(value: object, default: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return default
    try:
        parsed = int(value)
    except (ValueError, OverflowError):
        return default
    return parsed if parsed > 0 else default


def _response_json(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError as exc:
        raise AimlapiAuthError("AIMLAPI returned an invalid response") from exc
    if not isinstance(data, dict):
        raise AimlapiAuthError("AIMLAPI returned an invalid response")
    return data


def _verification_uri(request_id: str) -> str:
    """Rebuild the consent URL from the configured verification base.

    The create response returns a production consent URL even on staging, so
    the URL opened in the browser is always derived from
    ``AIMLAPI_VERIFICATION_BASE_URL`` rather than trusted from the response.
    ``source`` rides on the URL so a sign-up during consent is attributed to
    this integration (headers cannot cross the browser OAuth redirect).
    """
    from backend.api.features.aimlapi.config import AIMLAPI_SOURCE

    endpoint = resolve_endpoints().verification_base_url
    parsed = urlparse(endpoint)
    if not parsed.scheme or not parsed.netloc:
        raise AimlapiAuthError("AIMLAPI verification URL is invalid")
    path = f'{parsed.path.rstrip("/")}/agent/authorize'
    query = urlencode({"request": request_id, "source": AIMLAPI_SOURCE})
    return urlunparse((parsed.scheme, parsed.netloc, path, "", query, ""))


async def start_authorization() -> AuthorizationRequest:
    """Create a device authorization and return what the browser/poller need."""
    endpoints = resolve_endpoints()
    payload = {
        "partnerId": resolve_partner_id(),
        "partnerName": resolve_partner_name(),
        "agentName": AGENT_NAME,
        "returnUrl": endpoints.verification_base_url,
        "requestedUsdLimitMinor": resolve_requested_usd_limit_minor(),
    }
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{endpoints.app_base_url}/v3/agent-auth/authorizations",
                json=payload,
                headers=attribution_headers(),
            )
    except httpx.HTTPError as exc:
        raise AimlapiAuthError("Unable to start AIMLAPI authorization") from exc

    if response.status_code not in (200, 201):
        raise AimlapiAuthError(
            f"AIMLAPI authorization failed with HTTP {response.status_code}"
        )

    data = _response_json(response)
    request_id = str(data.get("requestId") or "").strip()
    device_code = str(data.get("deviceCode") or "").strip()
    if not request_id or not device_code:
        raise AimlapiAuthError("AIMLAPI authorization response is incomplete")

    interval = _positive_int(data.get("interval"), 5)
    expires_in = _positive_int(data.get("expiresIn"), 900)
    return AuthorizationRequest(
        request_id=request_id,
        device_code=device_code,
        verification_uri=_verification_uri(request_id),
        interval=interval,
        expires_at=time.time() + expires_in,
    )


async def poll_authorization(
    authorization: AuthorizationRequest,
) -> AuthorizationPollResult:
    """Exchange the device code for the issued key, or report the wait state."""
    if time.time() >= authorization.expires_at:
        return AuthorizationPollResult(status="expired")

    endpoints = resolve_endpoints()
    payload = {
        "partnerId": resolve_partner_id(),
        "deviceCode": authorization.device_code,
        "grant_type": DEVICE_CODE_GRANT,
    }
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{endpoints.app_base_url}/v3/agent-auth/token",
                json=payload,
                headers=attribution_headers(),
            )
    except httpx.HTTPError as exc:
        raise AimlapiAuthError("Unable to check AIMLAPI authorization") from exc

    if response.status_code not in (200, 201):
        raise AimlapiAuthError(
            f"AIMLAPI authorization check failed with HTTP {response.status_code}"
        )

    data = _response_json(response)
    status = str(data.get("status") or "").strip().lower()
    api_key = str(
        data.get("apiKey")
        or data.get("api_key")
        or data.get("access_token")
        or data.get("key")
        or ""
    ).strip()
    if api_key:
        return AuthorizationPollResult(status="ready", api_key=api_key)
    if status in TERMINAL_FAILURE_STATUSES:
        return AuthorizationPollResult(status=status)
    return AuthorizationPollResult(status=status or "pending")


async def validate_api_key(api_key: str) -> bool:
    """Return whether ``api_key`` authenticates against AIMLAPI.

    Sends an intentionally empty ``/chat/completions`` request: AIMLAPI checks
    auth before validating the body, so a bad key returns 401 while a valid key
    returns 400 (missing fields). No completion is generated, so the check is
    free. Raises ``AimlapiAuthError`` if AIMLAPI can't be reached.
    """
    base = resolve_inference_base_url()
    headers = {"Authorization": f"Bearer {api_key}", **attribution_headers()}
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{base}/chat/completions", headers=headers, json={}
            )
    except httpx.HTTPError as exc:
        raise AimlapiAuthError("Unable to reach AIMLAPI to verify the key") from exc
    return response.status_code != 401
