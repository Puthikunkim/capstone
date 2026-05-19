from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.event_participant import (
    EventParticipantCreate,
    EventParticipantResponse,
    EventParticipantUpdate,
)
from app.services.event_participants import (
    TeamAlreadyInEventError,
    create_event_participant,
    delete_event_participant,
    get_event_participant,
    list_event_participants,
    update_event_participant,
)

router = APIRouter(prefix="/event-participants", tags=["event-participants"])


@router.post("/", response_model=EventParticipantResponse, status_code=status.HTTP_201_CREATED)
def create_participant(payload: EventParticipantCreate, db: Session = Depends(get_db)):
    try:
        return create_event_participant(db, payload)
    except TeamAlreadyInEventError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/", response_model=list[EventParticipantResponse])
def list_participants(
    event_id: int | None = None,
    team_id: int | None = None,
    db: Session = Depends(get_db),
):
    return list_event_participants(db, event_id=event_id, team_id=team_id)


@router.get("/{participant_id}", response_model=EventParticipantResponse)
def get_participant(participant_id: int, db: Session = Depends(get_db)):
    participant = get_event_participant(db, participant_id)
    if participant is None:
        raise HTTPException(status_code=404, detail="Event participant not found")
    return participant


@router.patch("/{participant_id}", response_model=EventParticipantResponse)
def update_participant(
    participant_id: int,
    payload: EventParticipantUpdate,
    db: Session = Depends(get_db),
):
    participant = update_event_participant(db, participant_id, payload)
    if participant is None:
        raise HTTPException(status_code=404, detail="Event participant not found")
    return participant


@router.delete("/{participant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_participant(participant_id: int, db: Session = Depends(get_db)):
    deleted = delete_event_participant(db, participant_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Event participant not found")
