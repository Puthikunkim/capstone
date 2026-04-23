from __future__ import annotations

from enum import Enum

from sqlalchemy import CheckConstraint, Enum as SAEnum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CompetitionEventType(str, Enum):
    DRAG_RACE = "drag_race"
    GYMKHANA = "gymkhana"
    ENDURANCE_EFFICIENCY = "endurance_efficiency"


class Competition(Base):
    __tablename__ = "competitions"
    __table_args__ = (
        UniqueConstraint("name", name="uq_competitions_name"),
        CheckConstraint("length(trim(name)) > 0", name="ck_competitions_name_not_empty"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)

    events = relationship(
        "CompetitionEvent",
        back_populates="competition",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class CompetitionEvent(Base):
    __tablename__ = "competition_events"
    __table_args__ = (
        UniqueConstraint("competition_id", "event_type", name="uq_competition_events_type_per_competition"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    competition_id: Mapped[int] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[CompetitionEventType] = mapped_column(
        SAEnum(CompetitionEventType, name="competition_event_type", native_enum=False),
        nullable=False,
    )

    competition = relationship("Competition", back_populates="events")
