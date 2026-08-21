"""AIMLAPI (aiml_api) dynamic model catalog.

AIMLAPI is a model aggregator: a single key serves models from many creators
(OpenAI, Anthropic, DeepSeek, Meta, …) through one OpenAI-compatible endpoint.
Rather than hand-maintaining each model as a static ``LlmModel`` member, this
module loads the chat catalog from the public, keyless ``GET /v1/models`` and
lets ``llm.py`` inject the results as ``aiml_api`` members at import time.

Boot must never depend on the network: the live fetch is best-effort with a
short timeout, and a snapshot committed next to this module
(``data/aiml_models_snapshot.json``) is the guaranteed fallback. On a fresh
deploy the live fetch refreshes the set; if it is unreachable the snapshot
keeps the model list intact.
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import NamedTuple

import requests

logger = logging.getLogger(__name__)

# Same base URL (and override) the inference transport uses, so the catalog and
# the calls that follow it always target the same environment.
_INFERENCE_BASE = os.getenv("AIMLAPI_INFERENCE_URL", "https://api.aimlapi.com/v1")
_MODELS_URL = f"{_INFERENCE_BASE.rstrip('/')}/models"
_FETCH_TIMEOUT_SECONDS = 5
_SNAPSHOT_PATH = Path(__file__).parent / "data" / "aiml_models_snapshot.json"

# Only chat models belong in the LLM block dropdown.
_CHAT_TYPE = "openai/chat-completions"

# Mirrors ``catalog_model._SLUG_PATTERN`` — a catalog id that cannot satisfy it
# would fail payload validation and take the whole catalog down with it.
_SLUG_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9/._:-]{0,199}$")


class AimlModel(NamedTuple):
    id: str  # exact model string sent to the API (also the LlmModel value)
    name: str  # human display title
    developer: str  # model author, used for creator grouping + icon
    context_window: int
    max_output_tokens: int | None
    input_usd_per_1m: float | None
    output_usd_per_1m: float | None
    is_hottest: bool


def member_name(model_id: str) -> str:
    """Derive an ``LlmModel`` member name from a raw model id.

    ``"anthropic/claude-opus-4.5"`` -> ``"AIML_ANTHROPIC_CLAUDE_OPUS_4_5"``.
    Names are prefixed so they can never collide with the static members.
    """
    slug = "".join(ch if ch.isalnum() else "_" for ch in model_id)
    while "__" in slug:
        slug = slug.replace("__", "_")
    return "AIML_" + slug.strip("_").upper()


def _token_prices(pricing: dict) -> tuple[float | None, float | None]:
    """Extract (input, output) USD-per-1M-token from a model's pricing block.

    AIMLAPI tags both input and output token charges with ``measure:"output"``
    and distinguishes them by ``origin`` — ``provided`` = user-supplied (input)
    tokens, ``generated`` = model-produced (output) tokens.
    """
    input_price = output_price = None
    for unit in (pricing or {}).get("units", []):
        if unit.get("name") != "token" or unit.get("price") is None:
            continue
        per = unit.get("per") or 1_000_000
        usd_per_1m = round(unit["price"] * (1_000_000 / per), 6)
        origin = unit.get("origin")
        if origin == "provided" and input_price is None:
            input_price = usd_per_1m
        elif origin == "generated" and output_price is None:
            output_price = usd_per_1m
    return input_price, output_price


def _normalize(entry: dict) -> AimlModel | None:
    if entry.get("type") != _CHAT_TYPE:
        return None
    modalities = entry.get("modalities") or {}
    if "text" not in (modalities.get("output") or []):
        return None
    model_id = entry.get("id")
    if not model_id:
        return None
    info = entry.get("info") or {}
    input_price, output_price = _token_prices(entry.get("pricing"))
    return AimlModel(
        id=model_id,
        name=info.get("name") or model_id,
        developer=info.get("developer") or "AIMLAPI",
        context_window=int(info.get("contextLength") or 0),
        max_output_tokens=info.get("outputMax") or None,
        input_usd_per_1m=input_price,
        output_usd_per_1m=output_price,
        is_hottest=bool(info.get("isHottest")),
    )


def _from_snapshot_row(row: dict) -> AimlModel:
    return AimlModel(
        id=row["id"],
        name=row.get("name") or row["id"],
        developer=row.get("developer") or "AIMLAPI",
        context_window=int(row.get("context_length") or 0),
        max_output_tokens=row.get("output_max") or None,
        input_usd_per_1m=row.get("input_usd_1m"),
        output_usd_per_1m=row.get("output_usd_1m"),
        is_hottest=bool(row.get("is_hottest")),
    )


def _dedupe_hottest_first(models: list[AimlModel]) -> list[AimlModel]:
    # Hottest first (stable) so the deduper keeps the hottest variant, then drop
    # both exact-id repeats and API alias twins — the catalog exposes the same
    # model under several id spellings (e.g. ``gemini-3.6-flash`` vs
    # ``gemini-3-6-flash``), which share one (developer, display name).
    ordered = sorted(models, key=lambda m: 0 if m.is_hottest else 1)
    seen_ids: set[str] = set()
    seen_names: set[tuple[str, str]] = set()
    unique: list[AimlModel] = []
    for model in ordered:
        name_key = (model.developer, model.name)
        if model.id in seen_ids or name_key in seen_names:
            continue
        seen_ids.add(model.id)
        seen_names.add(name_key)
        unique.append(model)
    return unique


def _load_snapshot() -> list[AimlModel]:
    try:
        payload = json.loads(_SNAPSHOT_PATH.read_text())
        return _dedupe_hottest_first(
            [_from_snapshot_row(row) for row in payload.get("models", [])]
        )
    except (OSError, ValueError, KeyError) as exc:
        logger.warning("AIMLAPI model snapshot unavailable: %s", exc)
        return []


def _fetch_live() -> list[AimlModel]:
    # HEADERS.md: the attribution pair goes on EVERY aimlapi.com request, the
    # catalog included — not just inference and sign-up. Imported lazily and
    # from the feature config so there is exactly one definition of the pair;
    # that module is stdlib-only, so this costs nothing at import time.
    from backend.api.features.aimlapi.config import attribution_headers

    response = requests.get(
        _MODELS_URL,
        params={"include": "capabilities,modalities,pricing"},
        headers=attribution_headers(),
        timeout=_FETCH_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json().get("data") or []
    parsed = [m for m in (_normalize(entry) for entry in data) if m is not None]
    return _dedupe_hottest_first(parsed)


_cache: list[AimlModel] | None = None


def load_aiml_catalog() -> list[AimlModel]:
    """Return the AIMLAPI chat catalog (cached for the process lifetime).

    Tries the live endpoint first, falls back to the committed snapshot, and
    finally to an empty list — never raises, so importing ``llm.py`` cannot be
    blocked by the network.
    """
    global _cache
    if _cache is not None:
        return _cache
    try:
        live = _fetch_live()
        if live:
            _cache = live
            logger.info("Loaded %d AIMLAPI models from live catalog", len(live))
            return _cache
        logger.warning("AIMLAPI live catalog empty; using snapshot")
    except (requests.RequestException, ValueError) as exc:
        logger.warning("AIMLAPI live catalog fetch failed (%s); using snapshot", exc)
    _cache = _load_snapshot()
    return _cache


# ---------------------------------------------------------------------------
# Catalog injection
# ---------------------------------------------------------------------------
#
# Upstream moved model facts into a catalog-as-code file (``catalog.py``) whose
# ``_build_catalog()`` returns a static ``CatalogPayload``. AIMLAPI is an
# aggregator — one key serves hundreds of models that change weekly — so
# hand-authoring each of them there would go stale between deploys. Instead the
# loader above projects the live catalog into the same ``CatalogModel`` shape
# and ``_build_catalog()`` appends the result, so every downstream consumer
# (registry view, block metadata, cost config) sees AIMLAPI models through the
# ordinary catalog path with no special-casing.


def creator_name(developer: str) -> str:
    """Slugify a catalog ``developer`` into a ``CatalogCreator.name``.

    The schema constrains creator names to ``^[a-z0-9][a-z0-9._-]{0,99}$``,
    while the AIMLAPI catalog reports free-form display names ("Z.ai",
    "Mistral AI"). Collapse anything else to "-" and trim.
    """
    slug = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in developer.lower())
    while "--" in slug:
        slug = slug.replace("--", "-")
    slug = slug.strip("-._")
    return slug[:100] or "unknown"


def _price_tier(output_usd_per_1m: float) -> int:
    return 1 if output_usd_per_1m <= 5 else 2 if output_usd_per_1m <= 25 else 3


def aiml_catalog_additions(
    known_creators: set[str], known_slugs: set[str]
) -> tuple[list, list]:
    """Build ``(creators, models)`` to append to the canonical payload.

    ``known_slugs`` are the slugs the static catalog already declares — an
    aggregator entry must never shadow a native model and silently reroute
    existing graphs through AIMLAPI, so those are skipped. ``known_creators``
    keeps the creator list free of duplicate FK rows.
    """
    # Imported here: ``catalog_model`` is schema-only, but keeping the import
    # local means the loader stays usable (and testable) without pydantic.
    from backend.data.llm_registry.catalog_model import CatalogCreator, CatalogModel, CatalogModelCost

    creators: list[CatalogCreator] = []
    models: list[CatalogModel] = []
    seen_creators = set(known_creators)

    for model in load_aiml_catalog():
        if model.id in known_slugs:
            continue
        if not _SLUG_RE.match(model.id):
            logger.warning("skipping AIMLAPI model with unsupported slug: %s", model.id)
            continue

        creator = creator_name(model.developer)
        if creator not in seen_creators:
            seen_creators.add(creator)
            creators.append(
                CatalogCreator(name=creator, display_name=model.developer)
            )

        output_usd = model.output_usd_per_1m or 0.0
        models.append(
            CatalogModel(
                slug=model.id,
                display_name=model.name,
                provider="aiml_api",
                creator=creator,
                # The schema requires a positive window; the catalog omits it
                # for some entries, so fall back to the common 128k default
                # rather than dropping an otherwise-serviceable model.
                context_window=model.context_window or 128_000,
                max_output_tokens=model.max_output_tokens or None,
                price_tier=_price_tier(output_usd),
                # Flat per-run tier. Actual billing settles against the
                # per-token TOKEN_COST rates derived from AIML_TOKEN_PRICING;
                # this keeps the boot-time cost-completeness guard satisfied.
                cost=CatalogModelCost(run_credits=_price_tier(output_usd)),
            )
        )
    return creators, models
