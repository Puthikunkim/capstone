from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.scoring import ScoringEventResponse, ScoringMetric
from app.services.scoring import score_event_from_energy

router = APIRouter(prefix="/scoring", tags=["scoring"])


@router.get("/event/{event_id}", response_model=ScoringEventResponse)
def get_event_scoring(
    event_id: str,
    start: datetime,
    end: datetime,
    metric: ScoringMetric = ScoringMetric.ENERGY_WH,
    include_inactive: bool = False,
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
    )
