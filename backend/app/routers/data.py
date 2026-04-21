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

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.energy_frame import EnergyFrameIngest, EnergyFrameResponse
from app.services.broadcast import manager
from app.services.penalties import track_power_violation
from app.services.processing import convert_current_and_average, convert_voltage_and_average
from app.services.storage import check_and_record_alert, save_frame

router = APIRouter(tags=["data"])

logger = logging.getLogger(__name__)


@router.post("/data", response_model=EnergyFrameResponse)
async def ingest_frame(payload: EnergyFrameIngest, db: Session = Depends(get_db)):
    processed = {
        "ecu_serial": payload.ecu_serial,
        "timestamp": payload.timestamp,
        "avg_voltage": convert_voltage_and_average(payload.voltage_samples),
        "avg_current": convert_current_and_average(payload.current_samples),
        "energy": payload.energy,
    }

    frame, frame_created = save_frame(db, processed)
    if not frame_created:
        return frame

    violation_update = track_power_violation(db, frame, ecu=None)
    alert = None
    if violation_update.transition == "started":
        alert = check_and_record_alert(db, frame, ecu=None)

    await manager.notify(f"ecu_{frame.ecu_id}", EnergyFrameResponse.model_validate(frame).model_dump(mode="json"))

    if alert:
        await manager.notify_alert(alert)

    return frame
