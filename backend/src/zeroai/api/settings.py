"""Model configuration, stored in the database and editable at runtime."""

from urllib.parse import urlsplit

import structlog
from fastapi import APIRouter, HTTPException

from zeroai.api.deps import SessionDep, SettingsDep
from zeroai.destinations import DestinationPolicy
from zeroai.models import LLMConfig
from zeroai.schemas import LLMConfigRead, LLMConfigUpdate

router = APIRouter(prefix="/settings", tags=["settings"])
log = structlog.get_logger("zeroai.settings")


def _read(config: LLMConfig) -> LLMConfigRead:
    return LLMConfigRead(
        provider=config.provider,  # ty: ignore[invalid-argument-type]
        model=config.model,
        base_url=config.base_url,
        thinking=config.thinking,
        thinking_effort=config.thinking_effort,  # ty: ignore[invalid-argument-type]
        api_key_set=bool(config.api_key),
    )


async def _load(session: SessionDep) -> LLMConfig:
    config = await session.get(LLMConfig, 1)
    if config is None:
        raise HTTPException(status_code=500, detail="LLM configuration missing")
    return config


@router.get("/llm", operation_id="getLlmSettings")
async def get_llm_settings(session: SessionDep) -> LLMConfigRead:
    return _read(await _load(session))


@router.put("/llm", operation_id="updateLlmSettings")
async def update_llm_settings(
    payload: LLMConfigUpdate, session: SessionDep, settings: SettingsDep
) -> LLMConfigRead:
    try:
        DestinationPolicy(model_origins=settings.allowed_model_origins).validate_model_url(
            payload.provider, payload.base_url
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    config = await _load(session)
    config.provider = payload.provider
    config.model = payload.model
    config.base_url = payload.base_url
    if payload.thinking is not None:
        config.thinking = payload.thinking
    if payload.thinking_effort is not None:
        config.thinking_effort = payload.thinking_effort
    if payload.api_key is not None:
        config.api_key = payload.api_key.strip() or None
    session.add(config)
    await session.commit()
    await session.refresh(config)
    # Which settings changed matters; the API key itself must never reach a log line.
    log.info(
        "llm_settings_updated",
        provider=config.provider,
        model=config.model,
        thinking=config.thinking,
        thinking_effort=config.thinking_effort,
        base_url_host=urlsplit(config.base_url).hostname if config.base_url else None,
        api_key_set=bool(config.api_key),
        api_key_changed=payload.api_key is not None,
    )
    return _read(config)
