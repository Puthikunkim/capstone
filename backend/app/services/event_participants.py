from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event_participant import EventParticipant
from app.schemas.event_participant import EventParticipantCreate, EventParticipantUpdate


class TeamAlreadyInEventError(ValueError):
    pass


def create_event_participant(db: Session, payload: EventParticipantCreate) -> EventParticipant:
    existing = db.scalar(
        select(EventParticipant).where(
            EventParticipant.team_id == payload.team_id,
            EventParticipant.event_id == payload.event_id,
        )
    )
    if existing is not None:
        raise TeamAlreadyInEventError(
            f"Team {payload.team_id} is already registered for event {payload.event_id}"
        )

    participant = EventParticipant(
        team_id=payload.team_id,
        event_id=payload.event_id,
        start=payload.start,
        duration_seconds=payload.duration_seconds,
    )
    db.add(participant)
    db.commit()
    db.refresh(participant)
    return participant


def get_event_participant(db: Session, participant_id: int) -> EventParticipant | None:
    return db.get(EventParticipant, participant_id)


def list_event_participants(
    db: Session,
    event_id: int | None = None,
    team_id: int | None = None,
) -> list[EventParticipant]:
    stmt = select(EventParticipant).order_by(EventParticipant.start.asc(), EventParticipant.id.asc())
    if event_id is not None:
        stmt = stmt.where(EventParticipant.event_id == event_id)
    if team_id is not None:
        stmt = stmt.where(EventParticipant.team_id == team_id)
    return list(db.scalars(stmt).all())


def update_event_participant(
    db: Session,
    participant_id: int,
    payload: EventParticipantUpdate,
) -> EventParticipant | None:
    participant = db.get(EventParticipant, participant_id)
    if participant is None:
        return None

    if payload.start is not None:
        participant.start = payload.start
    if payload.duration_seconds is not None:
        participant.duration_seconds = payload.duration_seconds

    db.commit()
    db.refresh(participant)
    return participant


def delete_event_participant(db: Session, participant_id: int) -> bool:
    participant = db.get(EventParticipant, participant_id)
    if participant is None:
        return False
    db.delete(participant)
    db.commit()
    return True
