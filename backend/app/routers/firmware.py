"""Router: OTA firmware update endpoints."""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.firmware import (
    FirmwareJobStatus,
    FirmwareProgressUpdate,
    FirmwareStatusResponse,
    FirmwareUploadResponse,
)
from app.services.broadcast import manager
from app.services.storage import get_ecu, set_ecu_firmware_version

router = APIRouter(tags=["firmware"])

FIRMWARE_DIR = Path("firmware_uploads")
FIRMWARE_DIR.mkdir(exist_ok=True)

MAX_FIRMWARE_SIZE_BYTES = 8 * 1024 * 1024
ALLOWED_FIRMWARE_EXTENSIONS = {".bin"}
ALLOWED_CONTENT_TYPES = {
    "application/octet-stream",
    "application/x-binary",
    "binary/octet-stream",
}
ESP32_IMAGE_MAGIC = 0xE9

# In-memory OTA job tracker: ecu_id -> {status, progress, filename}
_jobs: dict[int, dict[str, Any]] = {}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _default_job_state() -> dict[str, Any]:
    return {
        "status": FirmwareJobStatus.IDLE.value,
        "progress": 0,
        "filename": None,
        "size_bytes": None,
        "checksum_sha256": None,
        "uploaded_at": None,
        "completed_at": None,
        "error_message": None,
    }


def _sanitize_filename(filename: str | None) -> str:
    safe_name = Path(filename or "").name
    if not safe_name or safe_name in {".", ".."}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid firmware filename")
    return safe_name


def _validate_firmware_file(upload: UploadFile, payload: bytes) -> tuple[str, int, str]:
    safe_name = _sanitize_filename(upload.filename)
    extension = Path(safe_name).suffix.lower()
    if extension not in ALLOWED_FIRMWARE_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported firmware extension '{extension}'. Allowed: {sorted(ALLOWED_FIRMWARE_EXTENSIONS)}",
        )

    content_type = (upload.content_type or "").lower()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported firmware content type '{content_type}'",
        )

    size_bytes = len(payload)
    if size_bytes == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Firmware file is empty")

    if size_bytes > MAX_FIRMWARE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Firmware file exceeds {MAX_FIRMWARE_SIZE_BYTES} bytes",
        )

    if payload[0] != ESP32_IMAGE_MAGIC:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Firmware image failed header validation",
        )

    checksum_sha256 = hashlib.sha256(payload).hexdigest()
    return safe_name, size_bytes, checksum_sha256


def _cleanup_firmware_files(ecu_id: int, keep_filename: str | None = None) -> None:
    for candidate in FIRMWARE_DIR.glob(f"ecu_{ecu_id}_*"):
        if keep_filename and candidate.name == keep_filename:
            continue
        try:
            candidate.unlink()
        except OSError:
            continue


def _build_status_response(ecu_id: int, firmware_version: str | None, job: dict[str, Any]) -> FirmwareStatusResponse:
    raw_status = str(job.get("status", FirmwareJobStatus.IDLE.value))
    status_value = FirmwareJobStatus(raw_status)
    return FirmwareStatusResponse(
        ecu_id=ecu_id,
        firmware_version=firmware_version,
        status=status_value,
        progress=int(job.get("progress", 0)),
        filename=job.get("filename"),
        size_bytes=job.get("size_bytes"),
        checksum_sha256=job.get("checksum_sha256"),
        uploaded_at=job.get("uploaded_at"),
        completed_at=job.get("completed_at"),
        error_message=job.get("error_message"),
    )


@router.post("/{ecu_id}/firmware", response_model=FirmwareUploadResponse)
async def upload_firmware(
    ecu_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    ecu = get_ecu(db, ecu_id)
    if ecu is None:
        raise HTTPException(status_code=404, detail="ECU not found")

    payload = await file.read()
    safe_name, size_bytes, checksum_sha256 = _validate_firmware_file(file, payload)

    # Keep only the most recent artifact for each ECU to limit disk usage.
    _cleanup_firmware_files(ecu_id)
    dest = FIRMWARE_DIR / f"ecu_{ecu_id}_{safe_name}"
    dest.write_bytes(payload)

    _jobs[ecu_id] = {
        "status": FirmwareJobStatus.PENDING.value,
        "progress": 0,
        "filename": dest.name,
        "size_bytes": size_bytes,
        "checksum_sha256": checksum_sha256,
        "uploaded_at": _now_utc(),
        "completed_at": None,
        "error_message": None,
    }

    await manager.notify(
        f"control_{ecu_id}",
        {
            "type": "ota_update",
            "download_url": f"/api/{ecu_id}/firmware/download",
            "filename": dest.name,
            "size_bytes": size_bytes,
            "checksum_sha256": checksum_sha256,
        },
    )

    return FirmwareUploadResponse(
        ecu_id=ecu_id,
        status=FirmwareJobStatus.PENDING,
        filename=dest.name,
        size_bytes=size_bytes,
        checksum_sha256=checksum_sha256,
    )


@router.get("/{ecu_id}/firmware/status", response_model=FirmwareStatusResponse)
async def get_firmware_status(ecu_id: int, db: Session = Depends(get_db)):
    ecu = get_ecu(db, ecu_id)
    if ecu is None:
        raise HTTPException(status_code=404, detail="ECU not found")

    job = _jobs.get(ecu_id, _default_job_state())
    return _build_status_response(ecu_id, ecu.firmware_version, job)


@router.post("/{ecu_id}/firmware/status", response_model=FirmwareStatusResponse)
async def report_firmware_progress(
    ecu_id: int,
    update: FirmwareProgressUpdate,
    db: Session = Depends(get_db),
):
    ecu = get_ecu(db, ecu_id)
    if ecu is None:
        raise HTTPException(status_code=404, detail="ECU not found")

    job = _jobs.get(ecu_id)
    if job is None:
        job = _default_job_state()
        _jobs[ecu_id] = job

    job["status"] = update.status.value
    job["progress"] = update.progress

    if update.error_message is not None:
        job["error_message"] = update.error_message

    if update.status == FirmwareJobStatus.SUCCESS:
        job["progress"] = 100
        job["completed_at"] = _now_utc()
        job["error_message"] = None
        if update.firmware_version:
            ecu = set_ecu_firmware_version(db, ecu_id, update.firmware_version) or ecu
        _cleanup_firmware_files(ecu_id, keep_filename=job.get("filename"))
    elif update.status == FirmwareJobStatus.FAILED:
        job["completed_at"] = _now_utc()
        if not job.get("error_message"):
            job["error_message"] = "Firmware update failed"
    else:
        job["completed_at"] = None

    return _build_status_response(ecu_id, ecu.firmware_version, job)


@router.get("/{ecu_id}/firmware/download")
async def download_firmware(ecu_id: int):
    job = _jobs.get(ecu_id)
    if not job or "filename" not in job:
        raise HTTPException(status_code=404, detail="No firmware available for this ECU")

    path = FIRMWARE_DIR / job["filename"]
    if not path.exists():
        job["status"] = FirmwareJobStatus.FAILED.value
        job["completed_at"] = _now_utc()
        job["error_message"] = "Firmware file not found"
        raise HTTPException(status_code=404, detail="Firmware file not found")

    if str(job.get("status")) == FirmwareJobStatus.PENDING.value:
        job["status"] = FirmwareJobStatus.DOWNLOADING.value

    return FileResponse(path, media_type="application/octet-stream", filename=job["filename"])
