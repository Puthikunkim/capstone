from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.ecu import ECU
from app.models.energy_frame import EnergyFrame
from app.models.power_violation_event import PowerViolationEvent

WARNING_ONLY_SECONDS = 1.0
PENALTY_SECONDS_PER_SECOND = 5.0


@dataclass(slots=True)
class ViolationUpdate:
	event: PowerViolationEvent | None
	transition: str
	over_limit: bool
	team_id: int | None = None


# Keep all internal timestamps UTC for consistent duration math.
def _to_utc(timestamp: datetime | None) -> datetime:
	if timestamp is None:
		return datetime.now(timezone.utc)

	if timestamp.tzinfo is None:
		return timestamp.replace(tzinfo=timezone.utc)

	return timestamp.astimezone(timezone.utc)


def _duration_seconds(start: datetime, end: datetime) -> float:
	return max(0.0, (end - start).total_seconds())


def _calculate_penalty_seconds(duration_seconds: float) -> float:
	if duration_seconds <= WARNING_ONLY_SECONDS:
		return 0.0

	return round((duration_seconds - WARNING_ONLY_SECONDS) * PENALTY_SECONDS_PER_SECOND, 3)


def _get_open_violation_event(db: Session, ecu_id: int) -> PowerViolationEvent | None:
	stmt: Select[tuple[PowerViolationEvent]] = (
		select(PowerViolationEvent)
		.where(
			PowerViolationEvent.ecu_id == ecu_id,
			PowerViolationEvent.end_timestamp.is_(None),
		)
		.order_by(PowerViolationEvent.start_timestamp.desc())
		.limit(1)
	)
	return db.scalar(stmt)


def track_power_violation(
	db: Session,
	frame: EnergyFrame,
	ecu: ECU | None = None,
) -> ViolationUpdate:
	attached_ecu = ecu if ecu is not None else db.get(ECU, frame.ecu_id)
	if attached_ecu is None:
		return ViolationUpdate(event=None, transition="none", over_limit=False)

	frame_timestamp = _to_utc(frame.timestamp)
	power_watts = float(frame.power_watts)
	limit_watts = float(attached_ecu.power_limit_watts)
	is_over_limit = power_watts > limit_watts
	open_event = _get_open_violation_event(db, attached_ecu.id)

	if is_over_limit:
		if open_event is None:
			event = PowerViolationEvent(
				ecu_id=attached_ecu.id,
				start_timestamp=frame_timestamp,
				last_over_timestamp=frame_timestamp,
				end_timestamp=None,
				duration_seconds=0.0,
				penalty_seconds=0.0,
				limit_watts=limit_watts,
				peak_power_watts=power_watts,
				frame_count=1,
				is_warning=True,
				trigger_frame_id=frame.id,
			)
			db.add(event)
			db.commit()
			db.refresh(event)
			return ViolationUpdate(event=event, transition="started", over_limit=True, team_id=attached_ecu.team_id)

		was_warning = open_event.is_warning
		open_event.frame_count += 1
		if frame_timestamp > _to_utc(open_event.last_over_timestamp):
			open_event.last_over_timestamp = frame_timestamp
		open_event.peak_power_watts = max(float(open_event.peak_power_watts), power_watts)
		open_event.limit_watts = limit_watts
		open_event.duration_seconds = _duration_seconds(_to_utc(open_event.start_timestamp), _to_utc(open_event.last_over_timestamp))
		open_event.penalty_seconds = _calculate_penalty_seconds(open_event.duration_seconds)
		open_event.is_warning = open_event.penalty_seconds == 0.0
		db.commit()
		db.refresh(open_event)
		transition = "escalated" if (was_warning and not open_event.is_warning) else "ongoing"
		return ViolationUpdate(event=open_event, transition=transition, over_limit=True, team_id=attached_ecu.team_id)

	if open_event is None:
		return ViolationUpdate(event=None, transition="none", over_limit=False)

	if frame_timestamp < _to_utc(open_event.last_over_timestamp):
		# Ignore out-of-order non-breach frames so they don't close active events early.
		return ViolationUpdate(event=open_event, transition="none", over_limit=False)

	open_event.end_timestamp = open_event.last_over_timestamp
	open_event.duration_seconds = _duration_seconds(_to_utc(open_event.start_timestamp), _to_utc(open_event.last_over_timestamp))
	open_event.penalty_seconds = _calculate_penalty_seconds(open_event.duration_seconds)
	open_event.is_warning = open_event.penalty_seconds == 0.0
	db.commit()
	db.refresh(open_event)
	return ViolationUpdate(event=open_event, transition="ended", over_limit=False, team_id=attached_ecu.team_id)


def get_violation_events(
	db: Session,
	ecu_id: int | None = None,
	start: datetime | None = None,
	end: datetime | None = None,
	open_only: bool = False,
	limit: int | None = 100,
) -> list[PowerViolationEvent]:
	stmt: Select[tuple[PowerViolationEvent]] = select(PowerViolationEvent)

	if ecu_id is not None:
		stmt = stmt.where(PowerViolationEvent.ecu_id == ecu_id)
	if start is not None:
		stmt = stmt.where(PowerViolationEvent.start_timestamp >= _to_utc(start))
	if end is not None:
		stmt = stmt.where(PowerViolationEvent.start_timestamp <= _to_utc(end))
	if open_only:
		stmt = stmt.where(PowerViolationEvent.end_timestamp.is_(None))

	stmt = stmt.order_by(PowerViolationEvent.start_timestamp.desc())
	if limit is not None:
		stmt = stmt.limit(max(0, limit))

	return list(db.scalars(stmt).all())


def get_violation_event(db: Session, event_id: int) -> PowerViolationEvent | None:
	return db.get(PowerViolationEvent, event_id)
