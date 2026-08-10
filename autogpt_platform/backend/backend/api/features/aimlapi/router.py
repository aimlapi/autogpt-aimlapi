"""API endpoints for the AIMLAPI "Get API key" device-authorization flow.

``start`` opens an authorization the user approves in the browser; ``poll``
returns the issued key once approved. The device code lives in a server-side
map keyed by request id — the browser only ever sees the request id and the
consent URL, so no redirect URI has to be registered for a given deployment.
"""

import time
from typing import Annotated

from autogpt_libs.auth import get_user_id
from fastapi import APIRouter, HTTPException, Security
from pydantic import BaseModel

from backend.api.features.aimlapi.service import (
    TERMINAL_FAILURE_STATUSES,
    AimlapiAuthError,
    AuthorizationRequest,
    poll_authorization,
    start_authorization,
)

router = APIRouter()

# request_id -> pending authorization. In-memory and per-process on purpose:
# the device code must never reach the browser, and the flow is short-lived
# (~15 min). A multi-worker deployment would need a shared store; a single
# instance is the common self-hosted case.
_PENDING: dict[str, AuthorizationRequest] = {}


def _prune(now: float) -> None:
    for request_id in [rid for rid, a in _PENDING.items() if now >= a.expires_at]:
        _PENDING.pop(request_id, None)


class AuthorizeStartResponse(BaseModel):
    request_id: str
    verification_uri: str
    interval: int
    expires_in: int


class AuthorizePollRequest(BaseModel):
    request_id: str


class AuthorizePollResponse(BaseModel):
    status: str
    api_key: str | None = None


@router.post("/authorize/start")
async def authorize_start(
    user_id: Annotated[str, Security(get_user_id)],
) -> AuthorizeStartResponse:
    """Begin a device authorization; the caller opens ``verification_uri``."""
    now = time.time()
    _prune(now)
    try:
        authorization = await start_authorization()
    except AimlapiAuthError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    _PENDING[authorization.request_id] = authorization
    return AuthorizeStartResponse(
        request_id=authorization.request_id,
        verification_uri=authorization.verification_uri,
        interval=authorization.interval,
        expires_in=max(0, int(authorization.expires_at - now)),
    )


@router.post("/authorize/poll")
async def authorize_poll(
    body: AuthorizePollRequest,
    user_id: Annotated[str, Security(get_user_id)],
) -> AuthorizePollResponse:
    """Exchange the server-held device code for the issued key, if approved."""
    now = time.time()
    _prune(now)
    authorization = _PENDING.get(body.request_id)
    if authorization is None:
        # Unknown or already-expired request id: report 'expired' rather than
        # 404 so the frontend shows the same "start again" state.
        return AuthorizePollResponse(status="expired")
    try:
        result = await poll_authorization(authorization)
    except AimlapiAuthError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if result.status == "ready" or result.status in TERMINAL_FAILURE_STATUSES:
        _PENDING.pop(body.request_id, None)
    return AuthorizePollResponse(status=result.status, api_key=result.api_key or None)
