"""Serial reader for ESP32 communication.

Replaces POST /api/data. Reads newline-delimited JSON from a serial port
and dispatches each message to the appropriate handler based on "type".

Message types:
    frame         — energy frame batch from ESP32
    firmware_status — OTA progress update from ESP32

Frame message format:
{
    "type": "frame",
    "ecu_id": 1,
    "frames": [
        {
            "tx_time_ms": "2026-03-29T10:00:00.000000+00:00",
            "voltage": [142, 142, ...],
            "current": [470, 142, ...]
        }
    ]
}

Firmware status message format:
{
    "type": "firmware_status",
    "ecu_id": 1,
    "status": "downloading",
    "progress": 45,
    "firmware_version": "1.2.3",
    "error_message": null
}

Usage:
    python serial_reader.py --port /dev/tty.usbserial-0001 --baud 115200
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from datetime import datetime, timezone

import serial

from app.database import SessionLocal
from app.routers.firmware import _jobs, _default_job_state, _now_utc, _cleanup_firmware_files
from app.schemas.firmware import FirmwareJobStatus
from app.services.ingest import persist_and_broadcast_frame
from app.services.processing import convert_current_and_average, convert_voltage_and_average
from app.services.storage import get_ecu, set_ecu_firmware_version

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def handle_frame(data: dict) -> None:
    ecu_serial = data.get("ecu_serial")
    frames = data.get("frames", [])

    if ecu_serial is None or not frames:
        logger.warning("handle_frame: missing ecu_id or frames")
        return

    sorted_frames = sorted(frames, key=lambda f: f.get("tx_time_ms", ""))

    db = SessionLocal()
    try:
        for frame in sorted_frames:
            voltage_samples = frame.get("voltage", [])
            current_samples = frame.get("current", [])

            if not voltage_samples or not current_samples:
                logger.warning("Empty samples, skipping frame")
                continue

            try:
                timestamp = datetime.fromisoformat(frame["tx_time_ms"])
            except (KeyError, ValueError):
                timestamp = datetime.now(timezone.utc)

            processed = {
                "ecu_serial": ecu_serial,
                "timestamp": timestamp,
                "avg_voltage": convert_voltage_and_average(voltage_samples),
                "avg_current": convert_current_and_average(current_samples),
            }

            _, created = await persist_and_broadcast_frame(db, processed)
            if created:
                logger.info("Frame saved — ECU %s  V=%.2f  A=%.3f",
                            ecu_serial, processed["avg_voltage"], processed["avg_current"])
    finally:
        db.close()


async def handle_firmware_status(data: dict) -> None:
    ecu_id = data.get("ecu_id")
    if ecu_id is None:
        logger.warning("handle_firmware_status: missing ecu_id")
        return

    db = SessionLocal()
    try:
        ecu = get_ecu(db, ecu_id)
        if ecu is None:
            logger.warning("handle_firmware_status: ECU %s not found", ecu_id)
            return

        job = _jobs.get(ecu_id)
        if job is None:
            job = _default_job_state()
            _jobs[ecu_id] = job

        raw_status = data.get("status", FirmwareJobStatus.IDLE.value)
        try:
            status = FirmwareJobStatus(raw_status)
        except ValueError:
            logger.warning("Unknown firmware status: %s", raw_status)
            return

        job["status"] = status.value
        job["progress"] = int(data.get("progress", job.get("progress", 0)))

        if data.get("error_message"):
            job["error_message"] = data["error_message"]

        if status == FirmwareJobStatus.SUCCESS:
            job["progress"] = 100
            job["completed_at"] = _now_utc()
            job["error_message"] = None
            firmware_version = data.get("firmware_version")
            if firmware_version:
                set_ecu_firmware_version(db, ecu_id, firmware_version)
            _cleanup_firmware_files(ecu_id, keep_filename=job.get("filename"))
        elif status == FirmwareJobStatus.FAILED:
            job["completed_at"] = _now_utc()
            if not job.get("error_message"):
                job["error_message"] = "Firmware update failed"

        logger.info("Firmware status — ECU %s: %s (%s%%)", ecu_id, status.value, job["progress"])
    finally:
        db.close()


HANDLERS = {
    "frame": handle_frame,
    "firmware_status": handle_firmware_status,
}


def _send_time_response(ser: serial.Serial) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")
    response = json.dumps({"timestamp": now}) + "\n"
    ser.write(response.encode("utf-8"))
    logger.info("Time sync response sent: %s", now)


async def dispatch(raw: str, ser: serial.Serial) -> None:
    if "TIME_REQUEST" in raw:
        _send_time_response(ser)
        return

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Non-JSON line: %s", raw[:120])
        return

    msg_type = data.get("type")
    handler = HANDLERS.get(msg_type)

    if handler is None:
        logger.warning("Unknown message type: %s", msg_type)
        return

    await handler(data)


async def read_serial(port: str, baud: int) -> None:
    logger.info("Opening serial port %s at %d baud", port, baud)
    try:
        ser = serial.Serial(port, baud, timeout=1)
    except serial.SerialException as exc:
        logger.error("Failed to open port: %s", exc)
        sys.exit(1)

    logger.info("Listening for messages...")
    loop = asyncio.get_event_loop()
    try:
        while True:
            line = await loop.run_in_executor(None, ser.readline)
            if not line:
                continue
            raw = line.decode("utf-8", errors="replace").strip()
            if raw:
                await dispatch(raw, ser)
    except KeyboardInterrupt:
        logger.info("Stopping")
    finally:
        ser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="EVolocity serial frame reader")
    parser.add_argument("--port", required=True, help="Serial port e.g. /dev/tty.usbserial-0001 or COM3")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default 115200)")
    args = parser.parse_args()

    asyncio.run(read_serial(args.port, args.baud))


if __name__ == "__main__":
    main()
