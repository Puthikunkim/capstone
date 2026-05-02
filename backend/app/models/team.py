from __future__ import annotations

from sqlalchemy import CheckConstraint, Enum as SAEnum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.ecu import VehicleClass, VehicleType


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (
        UniqueConstraint("name", name="uq_teams_name"),
        CheckConstraint("length(trim(name)) > 0", name="ck_teams_name_not_empty"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    competition_id: Mapped[int | None] = mapped_column(
        ForeignKey("competitions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    vehicle_class: Mapped[VehicleClass] = mapped_column(
        SAEnum(VehicleClass, name="vehicle_class", native_enum=False),
        nullable=False,
    )
    vehicle_type: Mapped[VehicleType] = mapped_column(
        SAEnum(VehicleType, name="vehicle_type", native_enum=False),
        nullable=False,
    )

    ecus = relationship("ECU", back_populates="team")
    competition = relationship("Competition", back_populates="teams")
