from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.scoring import ScoringEnergySource, ScoringEventResponse, ScoringMetric
from app.services.scoring import score_event_from_energy

router = APIRouter(prefix="/scoring", tags=["scoring"])

MAX_EFFICIENCY_WINDOW_SECONDS = 30


@router.get("/event/{event_id}", response_model=ScoringEventResponse)
def get_event_scoring(
    event_id: str,
    start: datetime,
    end: datetime,
    metric: ScoringMetric = ScoringMetric.ENERGY_WH,
    include_inactive: bool = False,
    energy_source: ScoringEnergySource = ScoringEnergySource.TRANSMITTED,
    db: Session = Depends(get_db),
):
    if end <= start:
        raise HTTPException(status_code=400, detail="'end' must be after 'start'")

    return score_event_from_energy(
        db=db,
        event_id=event_id,
        start=start,
        end=end,
        metric=metric,
        include_inactive=include_inactive,
        energy_source=energy_source,
    )


@router.get("/efficiency-leaderboard/{event_id}", response_model=ScoringEventResponse)
def get_efficiency_leaderboard(
    event_id: str,
    start: datetime,
    end: datetime,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
):
    if end <= start:
        raise HTTPException(status_code=400, detail="'end' must be after 'start'")

    window_seconds = (end - start).total_seconds()
    if window_seconds > MAX_EFFICIENCY_WINDOW_SECONDS:
        raise HTTPException(
            status_code=400,
            detail=f"Efficiency leaderboard window must be <= {MAX_EFFICIENCY_WINDOW_SECONDS} seconds",
        )

    return score_event_from_energy(
        db=db,
        event_id=event_id,
        start=start,
        end=end,
        metric=ScoringMetric.ENERGY_WH,
        include_inactive=include_inactive,
        energy_source=ScoringEnergySource.INTEGRATED_POWER,
    )
