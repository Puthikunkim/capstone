# This module contains the core logic for managing ECUs, energy frames, 
# and alerts in the application. It provides functions to save incoming 
# data frames, check for alert conditions, and retrieve stored data for 
# analysis and display. 
from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.ecu import ECU, VehicleClass, VehicleType
from app.models.energy_frame import EnergyFrame
from app.models.event_participant import EventParticipant

# Function to convert various input types to a standard dictionary format for easier processing.
def _to_dict(payload: Any) -> dict[str, Any]:
	if payload is None:
		return {}

	if isinstance(payload, Mapping):
		return dict(payload)

	if hasattr(payload, "model_dump"):
		return payload.model_dump(exclude_unset=True)

	if hasattr(payload, "dict"):
		try:
			return payload.dict(exclude_unset=True)
		except TypeError:
			return payload.dict()

	if hasattr(payload, "__dict__"):
		return {
			key: value
			for key, value in vars(payload).items()
			if not key.startswith("_")
		}

	raise TypeError(f"Unsupported payload type: {type(payload)!r}")

# Converts a given timestamp to UTC. 
def _to_utc(timestamp: datetime | None) -> datetime | None:
	if timestamp is None:
		return None

	if timestamp.tzinfo is None:
		return timestamp.replace(tzinfo=timezone.utc)

	return timestamp.astimezone(timezone.utc)

# Function for determining default power limits based on vehicle class
def _default_power_limit(vehicle_class: VehicleClass | str | None) -> float:
	if vehicle_class == VehicleClass.OPEN or vehicle_class == VehicleClass.OPEN.value:
		return 2000.0
	return 350.0

# Function to coerce string inputs to VehicleClass enum values
def _coerce_vehicle_class(value: VehicleClass | str | None) -> VehicleClass | None:
	if value is None or isinstance(value, VehicleClass):
		return value
	return VehicleClass(value)

# Function to coerce string inputs to VehicleType enum values
def _coerce_vehicle_type(value: VehicleType | str | None) -> VehicleType | None:
	if value is None or isinstance(value, VehicleType):
		return value
	return VehicleType(value)

# Core function for updating ECU data, energy frames, and alerts.
def _apply_ecu_updates(ecu: ECU, updates: Mapping[str, Any]) -> ECU:
	if "team_number" in updates and updates["team_number"] is not None:
		ecu.team_number = int(updates["team_number"])

	if "vehicle_class" in updates and updates["vehicle_class"] is not None:
		ecu.vehicle_class = _coerce_vehicle_class(updates["vehicle_class"]) or ecu.vehicle_class
		# Only apply the class default when no explicit power_limit_watts is provided
		if "power_limit_watts" not in updates or updates["power_limit_watts"] is None:
			ecu.power_limit_watts = _default_power_limit(ecu.vehicle_class)

	if "power_limit_watts" in updates and updates["power_limit_watts"] is not None:
		ecu.power_limit_watts = float(updates["power_limit_watts"])

	if "vehicle_type" in updates and updates["vehicle_type"] is not None:
		ecu.vehicle_type = _coerce_vehicle_type(updates["vehicle_type"]) or ecu.vehicle_type

	if "last_seen" in updates and updates["last_seen"] is not None:
		incoming_last_seen = _to_utc(updates["last_seen"])
		current_last_seen = _to_utc(ecu.last_seen)
		if current_last_seen is None or (
			incoming_last_seen is not None and incoming_last_seen > current_last_seen
		):
			ecu.last_seen = incoming_last_seen

	if "temperature" in updates and updates["temperature"] is not None:
		ecu.temperature = float(updates["temperature"])

	if "flash_usage" in updates and updates["flash_usage"] is not None:
		ecu.flash_usage = int(updates["flash_usage"])

	if "firmware_version" in updates and updates["firmware_version"] is not None:
		ecu.firmware_version = str(updates["firmware_version"])

	return ecu

# Retrieves an existing ECU by MAC address or creates a new one if it doesn't exist.
# This is used when processing incoming frames to ensure we have an ECU record to associate
# with the frame and any potential alerts.
def _get_or_create_ecu_by_mac(db: Session, frame_payload: Mapping[str, Any]) -> ECU:
	mac = str(frame_payload["mac_address"])
	ecu = db.scalar(select(ECU).where(ECU.mac_address == mac))
	if ecu is not None:
		return ecu

	vehicle_class = _coerce_vehicle_class(frame_payload.get("vehicle_class")) or VehicleClass.STANDARD
	vehicle_type = _coerce_vehicle_type(frame_payload.get("vehicle_type")) or VehicleType.BIKE
	power_limit = frame_payload.get("power_limit_watts")

	ecu = ECU(
		mac_address=mac,
		team_number=int(frame_payload.get("team_number", 0)),
		vehicle_class=vehicle_class,
		vehicle_type=vehicle_type,
		power_limit_watts=float(power_limit) if power_limit is not None else _default_power_limit(vehicle_class),
	)
	db.add(ecu)
	db.flush()
	return ecu

def save_frame(db: Session, frame_data: Any) -> tuple[EnergyFrame, bool]:
	payload = _to_dict(frame_data)
	ecu = _get_or_create_ecu_by_mac(db, payload)
	_apply_ecu_updates(
		ecu,
		{
			"team_number": payload.get("team_number"),
			"vehicle_class": payload.get("vehicle_class"),
			"vehicle_type": payload.get("vehicle_type"),
			"power_limit_watts": payload.get("power_limit_watts"),
			"last_seen": payload.get("timestamp"),
			"temperature": payload.get("temperature"),
			"flash_usage": payload.get("flash_usage"),
			"firmware_version": payload.get("firmware_version"),
		},
	) # Update ECU info because the incoming frame might have new info, and we want to keep our ECU records up to date. This also updates the last_seen timestamp which is important for connection status.

	frame_timestamp = _to_utc(payload["timestamp"])
	existing_frame = db.scalar(
		select(EnergyFrame).where(
			EnergyFrame.ecu_id == ecu.id,
			EnergyFrame.timestamp == frame_timestamp,
		)
	) # Check if a frame with the same ECU and timestamp already exists to prevent duplicates, which could happen if the same frame is sent multiple times due to network issues or retries.
	if existing_frame is not None:
		db.commit()
		db.refresh(existing_frame)
		return existing_frame, False

	frame = EnergyFrame(
		ecu_id=ecu.id,
		team_id=ecu.team_id,
		timestamp=frame_timestamp,
		avg_voltage=float(payload["avg_voltage"]),
		avg_current=float(payload["avg_current"]),
		voltage_samples=payload.get("voltage_samples"),
		current_samples=payload.get("current_samples"),
		power_watts=float(payload["avg_voltage"]) * float(payload["avg_current"]),
		energy=0.0,
	)
	db.add(frame)
	db.commit()
	db.refresh(frame)
	return frame, True

# Checks if the given energy frame breaches the power limit of its associated ECU and records an alert if necessary.
def check_and_record_alert(db: Session, frame: EnergyFrame, ecu: ECU | None = None) -> Alert | None:
	attached_ecu = ecu if ecu is not None else db.get(ECU, frame.ecu_id)
	if attached_ecu is None:
		return None

	power_watts = float(frame.power_watts)
	if power_watts <= float(attached_ecu.power_limit_watts):
		return None

	# Before creating a new alert, check if an alert for this frame already exists to prevent duplicates, which could happen if the same frame is processed multiple times due to network issues or retries.
	existing_alert = db.scalar(select(Alert).where(Alert.frame_id == frame.id))
	if existing_alert is not None:
		return existing_alert

	alert = Alert(
		ecu_id=attached_ecu.id,
		timestamp=_to_utc(frame.timestamp) or datetime.now(timezone.utc),
		power_watts=power_watts,
		limit_watts=float(attached_ecu.power_limit_watts),
		frame_id=frame.id,
	)
	db.add(alert)
	db.commit()
	db.refresh(alert)
	return alert

# Function to retrieve energy frames for a given ECU, with optional filtering by time range and limit on number of results. This is used by the frontend to display historical data.
def get_frames(
	db: Session,
	ecu_id: int,
	start: datetime | None = None,
	end: datetime | None = None,
	limit: int | None = 100,
) -> list[EnergyFrame]:
	stmt: Select[tuple[EnergyFrame]] = select(EnergyFrame).where(EnergyFrame.ecu_id == ecu_id)

	if start is not None:
		stmt = stmt.where(EnergyFrame.timestamp >= _to_utc(start))
	if end is not None:
		stmt = stmt.where(EnergyFrame.timestamp <= _to_utc(end))

	stmt = stmt.order_by(EnergyFrame.timestamp.asc())
	if limit is not None:
		stmt = stmt.limit(max(0, limit))

	return list(db.scalars(stmt).all())

# Function to retrieve an ecu by its ID.
def get_ecu(db: Session, ecu_id: int) -> ECU | None:
	return db.get(ECU, ecu_id)

# Function to list all ECUs, ordered by last seen time (most recent first) and then by serial number. This is used by the frontend to display the list of connected ECUs.
def list_ecus(db: Session) -> list[ECU]:
	stmt = select(ECU).order_by(ECU.last_seen.desc().nullslast(), ECU.mac_address.asc().nullslast())
	return list(db.scalars(stmt).all())

# Function to update ECU configuration based on provided updates. This is used by the frontend when an admin wants to change ECU settings like team number, vehicle class/type, or power limits.
def configure_ecu(db: Session, ecu_id: int, updates: Any) -> ECU | None:
	ecu = db.get(ECU, ecu_id)
	if ecu is None:
		return None

	payload = _to_dict(updates)
	_apply_ecu_updates(ecu, payload)
	db.commit()
	db.refresh(ecu)
	return ecu


def set_ecu_firmware_version(db: Session, ecu_id: int, firmware_version: str) -> ECU | None:
	ecu = db.get(ECU, ecu_id)
	if ecu is None:
		return None

	ecu.firmware_version = firmware_version
	db.commit()
	db.refresh(ecu)
	return ecu

# Function to retrieve alerts, with optional filtering by ECU and time range, and limit on number of results. This is used by the frontend to display alert history.
def get_alerts(
	db: Session,
	ecu_id: int | None = None,
	start: datetime | None = None,
	end: datetime | None = None,
	limit: int | None = 100,
) -> list[Alert]:
	stmt: Select[tuple[Alert]] = select(Alert)

	if ecu_id is not None:
		stmt = stmt.where(Alert.ecu_id == ecu_id)
	if start is not None:
		stmt = stmt.where(Alert.timestamp >= _to_utc(start))
	if end is not None:
		stmt = stmt.where(Alert.timestamp <= _to_utc(end))

	stmt = stmt.order_by(Alert.timestamp.desc())
	if limit is not None:
		stmt = stmt.limit(max(0, limit))

	return list(db.scalars(stmt).all())

# Function to retrieve a specific alert by its ID. This is used by the frontend when viewing details of a specific alert.
def get_alert(db: Session, alert_id: int) -> Alert | None:
	return db.get(Alert, alert_id)


class TeamNotEnrolledInEventError(ValueError):
	pass


def get_frames_for_team(
	db: Session,
	team_id: int,
	event_id: int | None = None,
	limit: int | None = 100,
) -> list[EnergyFrame]:
	stmt: Select[tuple[EnergyFrame]] = (
		select(EnergyFrame)
		.where(EnergyFrame.team_id == team_id)
		.order_by(EnergyFrame.timestamp.asc())
	)

	if event_id is not None:
		participant = db.scalar(
			select(EventParticipant).where(
				EventParticipant.team_id == team_id,
				EventParticipant.event_id == event_id,
			)
		)
		if participant is None:
			raise TeamNotEnrolledInEventError(
				f"Team {team_id} is not enrolled in event {event_id}"
			)
		if participant.start is not None:
			stmt = stmt.where(EnergyFrame.timestamp >= _to_utc(participant.start))
		if participant.start is not None and participant.duration_seconds is not None:
			end = participant.start + timedelta(seconds=participant.duration_seconds)
			stmt = stmt.where(EnergyFrame.timestamp <= _to_utc(end))

	if limit is not None:
		stmt = stmt.limit(max(0, limit))

	return list(db.scalars(stmt).all())
