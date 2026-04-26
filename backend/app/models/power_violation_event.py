from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PowerViolationEvent(Base):
	__tablename__ = "power_violation_events"
	__table_args__ = (
		Index("ix_power_violations_ecu_start", "ecu_id", "start_timestamp"),
		CheckConstraint("duration_seconds >= 0", name="ck_power_violations_duration_non_negative"),
		CheckConstraint("penalty_seconds >= 0", name="ck_power_violations_penalty_non_negative"),
		CheckConstraint("limit_watts > 0", name="ck_power_violations_limit_positive"),
		CheckConstraint("peak_power_watts >= 0", name="ck_power_violations_peak_non_negative"),
		CheckConstraint("frame_count >= 1", name="ck_power_violations_frame_count_positive"),
	)

	id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
	ecu_id: Mapped[int] = mapped_column(ForeignKey("ecus.id", ondelete="CASCADE"), nullable=False, index=True)
	start_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
	last_over_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
	end_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
	duration_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
	penalty_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
	limit_watts: Mapped[float] = mapped_column(Float, nullable=False)
	peak_power_watts: Mapped[float] = mapped_column(Float, nullable=False)
	frame_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
	is_warning: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

	ecu = relationship("ECU", back_populates="violation_events")
