"""Token-usage statistics, recorded per finished summary run."""

from typing import Annotated

from fastapi import APIRouter, Query

from zeroai.api.deps import SessionDep
from zeroai.schemas import ModelUsage, UsageRun
from zeroai.summary.usage import recent_runs, usage_by_model

router = APIRouter(prefix="/usage", tags=["usage"])


@router.get("", operation_id="getUsageByModel")
async def usage_per_model(session: SessionDep) -> list[ModelUsage]:
    return await usage_by_model(session)


@router.get("/runs", operation_id="getRecentRuns")
async def runs(
    session: SessionDep, limit: Annotated[int, Query(ge=1, le=200)] = 20
) -> list[UsageRun]:
    return await recent_runs(session, limit)
