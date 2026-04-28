"""Serial reader for ESP32 communication.

Reads binary adc_packet_t structs from serial port and dispatches to handlers.

Packet layout (little-endian, all fields packed):
  adc_packet_t  (216 bytes total)
    msg_type     uint8
    sender_id    uint8
    frame_count  uint8
    frames       adc_frame_t[MAX_FRAMES]

  adc_frame_t  (71 bytes each)
    counter      uint16
    frame        uint16
    timestamp    char[27]   (null-padded ISO string)
    current      int16[SAMPLES]
    voltage      int16[SAMPLES]

Usage:
    python serial_reader.py --port COM3 --baud 115200
"""

from __future__ import annotations

import argparse
import asyncio
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

SAMPLES = 10
MAX_FRAMES = 3
FRAME_SIZE = 2 + 2 + 27 + (2 * SAMPLES) + (2 * SAMPLES)   # 71 bytes
PACKET_SIZE = 1 + 1 + 1 + FRAME_SIZE * MAX_FRAMES           # 216 bytes

MSG_TYPE_ADC = 0x01


# ---------------------------------------------------------------------------
# Packet parsing
# ---------------------------------------------------------------------------

def parse_packet(raw: bytes) -> dict | None:
    """Unpack a raw adc_packet_t into a plain dict. Returns None on bad input."""
    if len(raw) < PACKET_SIZE:
        return None

    msg_type    = raw[0]
    sender_id   = raw[1]
    frame_count = raw[2]

    frames = []
    offset = 3
    for _ in range(min(frame_count, MAX_FRAMES)):
        counter, frame_num = struct.unpack_from("<HH", raw, offset)
        timestamp_str = (
            raw[offset + 4 : offset + 31]
            .decode("utf-8", errors="ignore")
            .rstrip("\x00")
        )
        current = list(struct.unpack_from("<10h", raw, offset + 31))
        voltage = list(struct.unpack_from("<10h", raw, offset + 51))
        offset += FRAME_SIZE

        frames.append({
            "counter":    counter,
            "frame":      frame_num,
            "tx_time_ms": timestamp_str,
            "current":    current,
            "voltage":    voltage,
        })

    return {
        "msg_type":    msg_type,
        "sender_id":   sender_id,
        "frame_count": frame_count,
        "frames":      frames,
    }


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

async def handle_adc_packet(packet: dict) -> None:
    ecu_serial = str(packet["sender_id"])
    frames = packet.get("frames", [])

    if not frames:
        logger.warning("handle_adc_packet: no frames in packet from ECU %s", ecu_serial)
        return

    sorted_frames = sorted(frames, key=lambda f: f.get("tx_time_ms", ""))

    db = SessionLocal()
    try:
        for frame in sorted_frames:
            logger.debug(
                "Raw frame — ECU %s  counter=%d  frame=%d  ts=%s  "
                "current=%s  voltage=%s",
                ecu_serial,
                frame["counter"],
                frame["frame"],
                frame["tx_time_ms"],
                frame["current"],
                frame["voltage"],
            )

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
                "ecu_serial": ingest.ecu_serial,
                "timestamp":  ingest.timestamp,
                "avg_voltage": convert_voltage_and_average(ingest.voltage_samples),
                "avg_current": convert_current_and_average(ingest.current_samples),
            }

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
                    "Duplicate frame skipped — ECU %s  counter=%d  ts=%s",
                    ecu_serial, frame["counter"], ingest.timestamp,
                )
    finally:
        db.close()


HANDLERS: dict[int, object] = {
    MSG_TYPE_ADC: handle_adc_packet,
}


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

async def dispatch(raw: bytes) -> None:
    packet = parse_packet(raw)
    if packet is None:
        logger.warning("Incomplete packet (%d bytes), skipping", len(raw))
        return

    logger.debug(
        "Packet received — msg_type=0x%02X  sender_id=%d  frame_count=%d",
        packet["msg_type"], packet["sender_id"], packet["frame_count"],
    )

    msg_type = packet["msg_type"]
    handler = HANDLERS.get(msg_type)

    if handler is None:
        logger.warning("Unknown msg_type: 0x%02X", msg_type)
        return

    await handler(packet)


# ---------------------------------------------------------------------------
# Serial read loop
# ---------------------------------------------------------------------------

async def read_serial(port: str, baud: int) -> None:
    logger.info("Opening %s at %d baud", port, baud)
    try:
        ser = serial.Serial(port, baud, timeout=1)
    except serial.SerialException as exc:
        logger.error("Failed to open port: %s", exc)
        sys.exit(1)

    logger.info("Listening for packets (%d bytes each)…", PACKET_SIZE)
    loop = asyncio.get_event_loop()
    try:
        while True:
            raw = await loop.run_in_executor(None, lambda: ser.read(PACKET_SIZE))
            if len(raw) < PACKET_SIZE:
                continue
            await dispatch(raw)
    except KeyboardInterrupt:
        logger.info("Stopping")
    finally:
        ser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="EVolocity serial frame reader")
    parser.add_argument("--port", required=True, help="Serial port e.g. COM3 or /dev/tty.usbserial-0001")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default 115200)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable DEBUG logging (raw frame samples)")
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    asyncio.run(read_serial(args.port, args.baud))


if __name__ == "__main__":
    main()
