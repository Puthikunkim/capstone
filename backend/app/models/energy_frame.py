from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EnergyFrame(Base):
	__tablename__ = "energy_frames"
	__table_args__ = (
		Index("ix_energy_frames_ecu_timestamp", "ecu_id", "timestamp"), # Composite Index: Useful for queries like getting all frames for an ECU ordered by time
		UniqueConstraint("ecu_id", "timestamp", name="uq_energy_frames_ecu_timestamp"), # An ECU should only have one frame per timestamp
		CheckConstraint("avg_voltage >= 0", name="ck_energy_frames_voltage_non_negative"), # Just in case, voltage should never be negative
	)

	id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
	ecu_id: Mapped[int] = mapped_column(ForeignKey("ecus.id", ondelete="CASCADE"), nullable=False, index=True) # Searching frames by ECU should be common, so indexed
	team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True)
	timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
	avg_voltage: Mapped[float] = mapped_column(Float, nullable=False)  # legacy, kept to satisfy NOT NULL; not exposed in API
	avg_current: Mapped[float] = mapped_column(Float, nullable=False)  # legacy, kept to satisfy NOT NULL; not exposed in API
	voltage_samples: Mapped[list | None] = mapped_column(JSON, nullable=True)
	current_samples: Mapped[list | None] = mapped_column(JSON, nullable=True)
	power_samples: Mapped[list | None] = mapped_column(JSON, nullable=True)
	power_watts: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)  # peak of power_samples; used by violation detection
	energy: Mapped[float] = mapped_column(Float, nullable=False)

	ecu = relationship("ECU", back_populates="energy_frames") # An energy frame belongs to an ECU, this field doesn't exist in the db
	team = relationship("Team", back_populates="energy_frames")
	alerts = relationship("Alert", back_populates="frame") # An energy frame can trigger many alerts
