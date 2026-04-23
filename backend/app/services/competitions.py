from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.competition import Competition, CompetitionEvent, CompetitionEventType
from app.schemas.competition import CompetitionCreate


class CompetitionNameConflictError(ValueError):
    pass


STANDARD_EVENT_TYPES: tuple[CompetitionEventType, ...] = (
    CompetitionEventType.DRAG_RACE,
    CompetitionEventType.GYMKHANA,
    CompetitionEventType.ENDURANCE_EFFICIENCY,
)


def create_competition(db: Session, payload: CompetitionCreate) -> Competition:
    normalized_name = payload.name.strip()

    existing = db.scalar(select(Competition).where(Competition.name == normalized_name))
    if existing is not None:
        raise CompetitionNameConflictError(
            f"A competition named '{normalized_name}' already exists"
        )

    competition = Competition(name=normalized_name)
    db.add(competition)
    db.flush()

    for event_type in STANDARD_EVENT_TYPES:
        db.add(
            CompetitionEvent(
                competition_id=competition.id,
                event_type=event_type,
            )
        )

    db.commit()
    db.refresh(competition)
    return get_competition(db, competition.id) or competition


def list_competitions(db: Session) -> list[Competition]:
    stmt = (
        select(Competition)
        .options(selectinload(Competition.events))
        .order_by(Competition.name.asc(), Competition.id.asc())
    )
    return list(db.scalars(stmt).all())


def get_competition(db: Session, competition_id: int) -> Competition | None:
    stmt = (
        select(Competition)
        .options(selectinload(Competition.events))
        .where(Competition.id == competition_id)
    )
    return db.scalar(stmt)
