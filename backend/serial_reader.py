"""Serial reader for ESP32 communication.

Reads binary adc_packet_t structs from serial port and dispatches to handlers.

Packet layout (little-endian, all fields packed):
  magic        4 bytes  (0xFF 0xFF 0xFF 0xFF)
  adc_packet_t (216 bytes total)
    msg_type     uint8
    sender_id    uint8
    frame_count  uint8
    frames       adc_frame_t[MAX_FRAMES=3]

  adc_frame_t  (71 bytes each)
    counter      uint16
    frame        uint16
    timestamp    char[27]   (null-padded ISO string)
    current      int16[10]
    voltage      int16[10]

Usage:
    python serial_reader.py --port COM3 --baud 115200
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import struct
import sys
from datetime import datetime, timezone

import serial
from pydantic import ValidationError

from app.database import SessionLocal
from app.schemas.energy_frame import EnergyFrameIngest
from app.services.ingest import persist_and_broadcast_frame
from app.services.processing import convert_current_and_average, convert_voltage_and_average

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── UART framing — must match controller UART framing registry ───
MAGIC       = b'\xFF\xFF\xFF\xFF'
SAMPLES     = 10
MAX_FRAMES  = 3

# adc_frame_t: counter(H) frame(H) timestamp(27s) current(10h) voltage(10h)
FRAME_FMT   = '<HH27s10h10h'
FRAME_SIZE  = struct.calcsize(FRAME_FMT)   # 71 bytes
PACKET_SIZE = 3 + (FRAME_SIZE * MAX_FRAMES)  # 216 bytes

MSG_TYPE_ADC = 0x04


# ---------------------------------------------------------------------------
# Time sync
# ---------------------------------------------------------------------------

def handle_time_sync(ser: serial.Serial) -> bool:
    logger.info("Waiting for TIME_REQUEST from controller...")
    ser.timeout = 6
    line = b''
    while True:
        byte = ser.read(1)
        if not byte:
            logger.error("Timed out waiting for TIME_REQUEST")
            return False
        line += byte
        if byte == b'\n':
            if b'TIME_REQUEST' in line:
                break
            line = b''

    now = datetime.now(timezone.utc)
    ts  = now.strftime('%Y-%m-%dT%H:%M:%S.') + f'{now.microsecond:06d}'
    response = json.dumps({"timestamp": ts}) + '\n'
    ser.write(response.encode('ascii'))
    ser.flush()

    logger.info("Time sync sent: %s", ts)
    ser.timeout = 1
    return True


# ---------------------------------------------------------------------------
# Sync + parse (runs in executor thread)
# ---------------------------------------------------------------------------

def sync_to_packet(ser: serial.Serial) -> bytes:
    buf = b''
    while True:
        byte = ser.read(1)
        if not byte:
            continue
        buf = (buf + byte)[-4:]
        if buf == MAGIC:
            return ser.read(PACKET_SIZE)


def parse_packet(raw: bytes) -> dict | None:
    if len(raw) < PACKET_SIZE:
        return None

    msg_type    = raw[0]
    sender_id   = raw[1]
    frame_count = raw[2]

    if frame_count < 1 or frame_count > MAX_FRAMES:
        return None

    frames = []
    for i in range(frame_count):
        offset = 3 + i * FRAME_SIZE
        counter, frame_num, ts_raw, *samples = struct.unpack_from(FRAME_FMT, raw, offset)
        frames.append({
            "counter":    counter,
            "frame":      frame_num,
            "tx_time_ms": ts_raw.rstrip(b'\x00').decode('ascii', errors='replace'),
            "current":    list(samples[:SAMPLES]),
            "voltage":    list(samples[SAMPLES:]),
        })

    return {
        "msg_type":    msg_type,
        "sender_id":   sender_id,
        "frame_count": frame_count,
        "frames":      frames,
    }


# ---------------------------------------------------------------------------
# Frame processor (consumes queue)
# ---------------------------------------------------------------------------

async def process_frames(queue: asyncio.Queue) -> None:
    while True:
        frame = await queue.get()
        try:
            ecu_serial = str(frame["sender_id"])

            try:
                timestamp = datetime.fromisoformat(frame["tx_time_ms"])
            except (KeyError, ValueError):
                logger.warning(
                    "Bad timestamp %r on ECU %s counter=%d, using server time",
                    frame.get("tx_time_ms"), ecu_serial, frame["counter"],
                )
                timestamp = datetime.now(timezone.utc)

            try:
                ingest = EnergyFrameIngest(
                    ecu_serial=ecu_serial,
                    timestamp=timestamp,
                    voltage_samples=frame["voltage"],
                    current_samples=frame["current"],
                )
            except ValidationError as exc:
                logger.warning(
                    "Schema validation failed for ECU %s counter=%d: %s",
                    ecu_serial, frame["counter"], exc,
                )
                continue

            processed = {
                "ecu_serial":  ingest.ecu_serial,
                "timestamp":   ingest.timestamp,
                "avg_voltage": convert_voltage_and_average(ingest.voltage_samples),
                "avg_current": convert_current_and_average(ingest.current_samples),
            }

            db = SessionLocal()
            try:
                _, created = await persist_and_broadcast_frame(db, processed)
                if created:
                    logger.info(
                        "Frame saved — ECU %s  counter=%d  V=%.2f  A=%.3f",
                        ecu_serial,
                        frame["counter"],
                        processed["avg_voltage"],
                        processed["avg_current"],
                    )
                else:
                    logger.debug(
                        "Duplicate frame skipped — ECU %s  counter=%d",
                        ecu_serial, frame["counter"],
                    )
            finally:
                db.close()

        except Exception as exc:
            logger.error("Error processing frame: %s", exc)
        finally:
            queue.task_done()


# ---------------------------------------------------------------------------
# Serial reader (produces queue)
# ---------------------------------------------------------------------------

async def read_serial(port: str, baud: int, queue: asyncio.Queue) -> None:
    logger.info("Opening %s at %d baud", port, baud)
    try:
        ser = serial.Serial(port, baud, timeout=1)
    except serial.SerialException as exc:
        logger.error("Failed to open port: %s", exc)
        sys.exit(1)

    if not handle_time_sync(ser):
        logger.warning("Time sync failed — ECU timestamps will be epoch")

    logger.info("Listening for packets (%d bytes each)…", PACKET_SIZE)
    loop = asyncio.get_event_loop()
    try:
        while True:
            raw = await loop.run_in_executor(None, lambda: sync_to_packet(ser))
            packet = parse_packet(raw)
            if packet is None:
                logger.warning("Invalid packet, skipping")
                continue

            for frame in packet["frames"]:
                frame["sender_id"] = packet["sender_id"]
                await queue.put(frame)

            logger.debug(
                "Packet queued — ECU %d  frame_count=%d  queue_size=%d",
                packet["sender_id"], packet["frame_count"], queue.qsize(),
            )

    except KeyboardInterrupt:
        logger.info("Stopping")
    finally:
        ser.close()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def run(port: str, baud: int) -> None:
    queue: asyncio.Queue = asyncio.Queue()
    await asyncio.gather(
        read_serial(port, baud, queue),
        process_frames(queue),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="EVolocity serial frame reader")
    parser.add_argument("--port", required=True, help="Serial port e.g. COM3")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    asyncio.run(run(args.port, args.baud))


if __name__ == "__main__":
    main()