# Router: OTA firmware update endpoints.
#
# POST /ecu/{id}/firmware
#   - Accepts a firmware file.
#   - Stores the file temporarily on the server, then sends a firmware
#     update command to the target ESP32 using a dedicated WebSocket
#     control channel.
#   - The ESP32 fetches the file from a temporary endpoint and performs
#     the OTA flash.
#   - Returns status code with a target job to poll for progress.
#
# GET /ecu/{id}/firmware/status
#   - Returns the current firmware update status for an ECU:
#   - status, progress (updated by the ESP32), and firmware version
#
# POST /ecu/{id}/firmware/status
#   Called by the ESP32 to report OTA progress back to the server
#   during a flash.
#
# GET /ecu/{id}/firmware/download
#   Serves the firmware file to the ESP32 during an OTA update.

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.broadcast import manager
from app.services.storage import get_ecu

router = APIRouter(tags=["firmware"])

FIRMWARE_DIR = Path("firmware_uploads")
FIRMWARE_DIR.mkdir(exist_ok=True)

# In-memory OTA job tracker: ecu_id -> {status, progress, filename}
_jobs: dict[int, dict] = {}


@router.post("/{ecu_id}/firmware")
async def upload_firmware(
    ecu_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    ecu = get_ecu(db, ecu_id)
    if ecu is None:
        raise HTTPException(status_code=404, detail="ECU not found")

    dest = FIRMWARE_DIR / f"ecu_{ecu_id}_{file.filename}"
    dest.write_bytes(await file.read())

    _jobs[ecu_id] = {"status": "pending", "progress": 0, "filename": dest.name}

    await manager.notify(f"control_{ecu_id}", {
        "type": "ota_update",
        "download_url": f"/api/ecu/{ecu_id}/firmware/download",
    })

    return {"ecu_id": ecu_id, "status": "pending"}


@router.get("/{ecu_id}/firmware/status")
async def get_firmware_status(ecu_id: int, db: Session = Depends(get_db)):
    ecu = get_ecu(db, ecu_id)
    if ecu is None:
        raise HTTPException(status_code=404, detail="ECU not found")

    job = _jobs.get(ecu_id, {"status": "idle", "progress": 0})
    return {"ecu_id": ecu_id, "firmware_version": ecu.firmware_version, **job}


@router.post("/{ecu_id}/firmware/status")
async def report_firmware_progress(ecu_id: int, update: dict, db: Session = Depends(get_db)):
    ecu = get_ecu(db, ecu_id)
    if ecu is None:
        raise HTTPException(status_code=404, detail="ECU not found")

    if ecu_id in _jobs:
        _jobs[ecu_id].update(update)

    return {"ok": True}


@router.get("/{ecu_id}/firmware/download")
async def download_firmware(ecu_id: int):
    job = _jobs.get(ecu_id)
    if not job or "filename" not in job:
        raise HTTPException(status_code=404, detail="No firmware available for this ECU")

    path = FIRMWARE_DIR / job["filename"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Firmware file not found")

    return FileResponse(path, media_type="application/octet-stream", filename=job["filename"])
