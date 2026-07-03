from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class FirmwareJobStatus(str, Enum):
    IDLE = "idle"
    PENDING = "pending"
    DOWNLOADING = "downloading"
    FLASHING = "flashing"
    SUCCESS = "success"
    FAILED = "failed"


class FirmwareUploadResponse(BaseModel):
    ecu_id: int
    status: FirmwareJobStatus
    filename: str
    size_bytes: int
    checksum_sha256: str


class FirmwareStatusResponse(BaseModel):
    ecu_id: int
    firmware_version: str | None
    status: FirmwareJobStatus
    progress: int = Field(ge=0, le=100)
    filename: str | None = None
    size_bytes: int | None = None
    checksum_sha256: str | None = None
    uploaded_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None


class FirmwareProgressUpdate(BaseModel):
    status: FirmwareJobStatus
    progress: int = Field(default=0, ge=0, le=100)
    firmware_version: str | None = Field(default=None, max_length=64)
    error_message: str | None = Field(default=None, max_length=512)
