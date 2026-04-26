# Router: POST /data
#   - Receives energy frame payloads posted by an ESP32.
#   - Validates the incoming payload.
#   - Persists the frame to db.
#   - Frames are stored by their ECU reported timestamp, not server
#     receive time, so that frames buffered on the ESP32 during a
#     disconnection are stored in correct chronological order when
#     the ECU reconnects.
#   - Detect power limit breaches
#   - Push the new frame to WebSocket clients on that ECU's channel.
#   - Should handle at least 100 Hz per connected ESP32.
#   - Data must be stored and displayed at at least 10 Hz
#   - Greater than 100 Hz ADC sampling on the ESP32 is averaged before posting.

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.energy_frame import EnergyFrame
from app.schemas.energy_frame import (
    EnergyFrameBatchIngest,
    EnergyFrameBatchResponse,
    EnergyFrameIngest,
    EnergyFrameResponse,
)
from app.services.broadcast import manager
from app.services.penalties import track_power_violation
from app.services.processing import convert_current_and_average, convert_voltage_and_average
from app.services.storage import check_and_record_alert, save_frame

router = APIRouter(tags=["data"])

logger = logging.getLogger(__name__)


def _to_utc(timestamp: datetime) -> datetime:
    if timestamp.tzinfo is None:
        return timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc)


def _process_payload(payload: EnergyFrameIngest) -> dict[str, object]:
    return {
        "ecu_serial": payload.ecu_serial,
        "timestamp": payload.timestamp,
        "avg_voltage": convert_voltage_and_average(payload.voltage_samples),
        "avg_current": convert_current_and_average(payload.current_samples),
        "energy": payload.energy,
    }


async def _persist_and_broadcast_frame(db: Session, processed: dict[str, Any]) -> tuple[EnergyFrame, bool]:
    frame, frame_created = save_frame(db, processed)
    if not frame_created:
        return frame, False

    violation_update = track_power_violation(db, frame, ecu=None)
    alert = None
    if violation_update.transition == "started":
        alert = check_and_record_alert(db, frame, ecu=None)

    if violation_update.event is not None and violation_update.transition in {"started", "ended"}:
        await manager.notify_violation_event(violation_update.event, violation_update.transition)

    await manager.notify(f"ecu_{frame.ecu_id}", EnergyFrameResponse.model_validate(frame).model_dump(mode="json"))

    if alert:
        await manager.notify_alert(alert)

    return frame, True


@router.post("/data", response_model=EnergyFrameResponse)
async def ingest_frame(payload: EnergyFrameIngest, db: Session = Depends(get_db)):
    processed = _process_payload(payload)
    frame, _ = await _persist_and_broadcast_frame(db, processed)
    return frame


@router.post("/data/batch", response_model=EnergyFrameBatchResponse)
async def ingest_frame_batch(payload: EnergyFrameBatchIngest, db: Session = Depends(get_db)):
    sorted_frames = sorted(
        enumerate(payload.frames),
        key=lambda item: (_to_utc(item[1].timestamp), item[0]),
    )

    inserted_frames: list[EnergyFrame] = []
    duplicates = 0

    for _, frame_payload in sorted_frames:
        processed = _process_payload(frame_payload)
        frame, frame_created = await _persist_and_broadcast_frame(db, processed)
        if frame_created:
            inserted_frames.append(frame)
        else:
            duplicates += 1

    return EnergyFrameBatchResponse(
        received=len(payload.frames),
        inserted=len(inserted_frames),
        duplicates=duplicates,
        frames=[EnergyFrameResponse.model_validate(frame) for frame in inserted_frames],
    )
