from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum

from sqlalchemy import CheckConstraint, DateTime, Enum as SAEnum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class VehicleClass(str, Enum):
	STANDARD = "Standard"
	OPEN = "Open"


class VehicleType(str, Enum):
	BIKE = "bike"
	KART = "kart"


CONNECTION_TIMEOUT_SECONDS = 10 # Can be changed (not specified in requirements)


class ECU(Base):
	__tablename__ = "ecus"
	__table_args__ = (
		CheckConstraint("team_number >= 0", name="ck_ecus_team_number_non_negative"), # Just in case, team numbers should be non-negative
		CheckConstraint("power_limit_watts > 0", name="ck_ecus_power_limit_positive"), # Just in case, power limits should be positive
	)

	id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
	mac_address: Mapped[str | None] = mapped_column(String(17), unique=True, nullable=True, index=True)
	team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True)
	team_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
	vehicle_class: Mapped[VehicleClass] = mapped_column(
		SAEnum(VehicleClass, name="vehicle_class", native_enum=False),
		nullable=False,
		default=VehicleClass.STANDARD,
	) # Bridges Python Enum to a VARCHAR in the database, with a CHECK constraint to enforce valid values and not using the database's native enum type
	vehicle_type: Mapped[VehicleType] = mapped_column(
		SAEnum(VehicleType, name="vehicle_type", native_enum=False),
		nullable=False,
		default=VehicleType.BIKE,
	)
	power_limit_watts: Mapped[float] = mapped_column(Float, nullable=False, default=350.0)
	last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True) # Stored as UTC timestamps, but can be None if the ECU has never connected
	temperature: Mapped[float | None] = mapped_column(Float, nullable=True) # Stored as UTC temperatures, but can be None if not available
	flash_usage: Mapped[int | None] = mapped_column(Integer, nullable=True) 
	firmware_version: Mapped[str | None] = mapped_column(String(64), nullable=True) # Limited to 64 chars, should be enough for typical firmware version strings

	energy_frames = relationship(
		"EnergyFrame",
		back_populates="ecu",
		cascade="all, delete-orphan",
		passive_deletes=True,
	) # An ECU can have many energy frames, if an ECU is deleted, we want all its frames to be deleted as well, and we want the database to handle this cascade for integrity and performance
	team = relationship("Team", back_populates="ecus")
	alerts = relationship(
		"Alert",
		back_populates="ecu",
		cascade="all, delete-orphan",
		passive_deletes=True,
	) 
	violation_events = relationship(
		"PowerViolationEvent",
		back_populates="ecu",
		cascade="all, delete-orphan",
		passive_deletes=True,
	)
    
	@property
	def is_connected(self) -> bool: # A simple heuristic to determine if the ECU is currently connected based on the last time it was seen. Useful for the frontend to show connection status.
		if self.last_seen is None:
			return False

		if self.last_seen.tzinfo is None: # If the timestamp is naive, we assume it's in UTC for consistency. In practice, all timestamps should be timezone-aware and in UTC, but this is a safeguard.
			last_seen_utc = self.last_seen.replace(tzinfo=timezone.utc)
		else:
			last_seen_utc = self.last_seen.astimezone(timezone.utc)

		return datetime.now(timezone.utc) - last_seen_utc <= timedelta(seconds=CONNECTION_TIMEOUT_SECONDS)
