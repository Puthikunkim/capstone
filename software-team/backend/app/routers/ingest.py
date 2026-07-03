from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.energy_frame import EnergyFrameIngest
from app.services.ingest import persist_and_broadcast_frame
from app.services.processing import compute_power_samples

router = APIRouter(tags=["ingest"])


@router.post("/data", status_code=status.HTTP_204_NO_CONTENT)
async def ingest_frame(payload: EnergyFrameIngest, db: Session = Depends(get_db)) -> None:
    processed = {
        "mac_address": payload.mac_address,
        "timestamp": payload.timestamp,
        "voltage_samples": payload.voltage_samples,
        "current_samples": payload.current_samples,
        "power_samples": compute_power_samples(payload.voltage_samples, payload.current_samples),
    }
    await persist_and_broadcast_frame(db, processed)
