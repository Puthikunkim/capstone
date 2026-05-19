from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EnergyFrame(Base):
	__tablename__ = "energy_frames"
	__table_args__ = (
		Index("ix_energy_frames_ecu_timestamp", "ecu_id", "timestamp"),
		UniqueConstraint("ecu_id", "timestamp", name="uq_energy_frames_ecu_timestamp"),
	)

	id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
	ecu_id: Mapped[int] = mapped_column(ForeignKey("ecus.id", ondelete="CASCADE"), nullable=False, index=True) # Searching frames by ECU should be common, so indexed
	team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True)
	timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
	voltage_samples: Mapped[list | None] = mapped_column(JSON, nullable=True)
	current_samples: Mapped[list | None] = mapped_column(JSON, nullable=True)
	power_samples: Mapped[list | None] = mapped_column(JSON, nullable=True)
	power_watts: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # peak of power_samples; used by violation detection
	energy: Mapped[float] = mapped_column(Float, nullable=False)

	ecu = relationship("ECU", back_populates="energy_frames")
	team = relationship("Team", back_populates="energy_frames")
