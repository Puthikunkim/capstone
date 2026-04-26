from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.competition import (
    CompetitionCreate,
    CompetitionDetailResponse,
    CompetitionResponse,
)
from app.services.competitions import (
    CompetitionNameConflictError,
    create_competition,
    get_competition,
    list_competitions,
)

router = APIRouter(prefix="/competitions", tags=["competitions"])


@router.post("/", response_model=CompetitionDetailResponse, status_code=status.HTTP_201_CREATED)
def create_competition_entry(payload: CompetitionCreate, db: Session = Depends(get_db)):
    try:
        return create_competition(db, payload)
    except CompetitionNameConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/", response_model=list[CompetitionResponse])
def list_competition_entries(db: Session = Depends(get_db)):
    return list_competitions(db)


@router.get("/{competition_id}", response_model=CompetitionDetailResponse)
def get_competition_entry(competition_id: int, db: Session = Depends(get_db)):
    competition = get_competition(db, competition_id)
    if competition is None:
        raise HTTPException(status_code=404, detail="Competition not found")
    return competition
