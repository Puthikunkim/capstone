# Router: ECU management endpoints
#
# GET  /ecu          - list all ECUs
# GET  /ecu/{id}     - return full config and current status for one ECU
# POST /ecu/{id}/configure - update config fields for one ECU
# GET  /ecu/{id}/history   - return stored energy frames

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.ecu import ECUConfigure, ECUResponse
from app.schemas.energy_frame import EnergyFrameResponse
from app.services.broadcast import manager
from app.services.storage import configure_ecu, get_ecu, get_frames, list_ecus

router = APIRouter(prefix = '/ecu', tags=["ecu"])


@router.get("/", response_model=list[ECUResponse])
def list_all_ecus(db: Session = Depends(get_db)):
    return list_ecus(db)


@router.get("/{ecu_id}", response_model=ECUResponse)
def get_ecu_by_id(ecu_id: int, db: Session = Depends(get_db)):
    ecu = get_ecu(db, ecu_id)
    if ecu is None:
        raise HTTPException(status_code=404, detail="ECU not found")
    return ecu


@router.post("/{ecu_id}/configure", response_model=ECUResponse)
async def configure_ecu_by_id(ecu_id: int, updates: ECUConfigure, db: Session = Depends(get_db)):
    ecu = configure_ecu(db, ecu_id, updates)
    if ecu is None:
        raise HTTPException(status_code=404, detail="ECU not found")

    await manager.notify(
        f"control_{ecu_id}",
        {
            "type": "config_update",
            "ecu_id": ecu.id,
            "serial_number": ecu.serial_number,
            "team_number": ecu.team_number,
            "vehicle_class": ecu.vehicle_class.value,
            "vehicle_type": ecu.vehicle_type.value,
            "power_limit_watts": ecu.power_limit_watts,
        },
    )

    return ecu


@router.get("/{ecu_id}/history", response_model=list[EnergyFrameResponse])
def get_ecu_history(
    ecu_id: int,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    ecu = get_ecu(db, ecu_id)
    if ecu is None:
        raise HTTPException(status_code=404, detail="ECU not found")
    return get_frames(db, ecu_id, start=start, end=end, limit=limit)
