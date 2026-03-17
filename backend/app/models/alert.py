from __future__ import annotations # For forward references in type hints

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Alert(Base):
	__tablename__ = "alerts"
	__table_args__ = (
		Index("ix_alerts_ecu_timestamp", "ecu_id", "timestamp"), # Composite Index: Useful for queries like getting all alerts for an ECU ordered by time
		CheckConstraint("power_watts >= 0", name="ck_alerts_power_non_negative"), # Just in case, power should never be negative
		CheckConstraint("limit_watts > 0", name="ck_alerts_limit_positive"), # Just in case, limits should be positive
	)

	id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
	ecu_id: Mapped[int] = mapped_column(ForeignKey("ecus.id", ondelete="CASCADE"), nullable=False, index=True) # Searching alerts by ECU should be common, so indexed
	timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now()) # Default to current time if not provided, but should usually be set explicitly to match the frame timestamp
	power_watts: Mapped[float] = mapped_column(Float, nullable=False)
	limit_watts: Mapped[float] = mapped_column(Float, nullable=False)
	frame_id: Mapped[int] = mapped_column(ForeignKey("energy_frames.id", ondelete="CASCADE"), nullable=False, index=True) # Indexed for potential queries joining alerts to frames

	ecu = relationship("ECU", back_populates="alerts") # Alerts belong to an ECU
	frame = relationship("EnergyFrame", back_populates="alerts") # Alerts are triggered by a specific energy frame, so we link them directly for easy access to frame data when analysing alerts
