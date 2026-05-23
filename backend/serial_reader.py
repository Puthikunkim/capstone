"""Serial reader for ESP32 communication.

Reads newline-delimited JSON packets from the controller over UART and
dispatches frames to the ingest pipeline.

JSON packet format (one line per packet):
  {"mac": "<AA:BB:CC:DD:EE:FF>", "rx_time_ms": <int>, "frames": [<frame>, ...]}

  frame:
    {"counter": <int>, "tx_time_ms": <int>, "voltage": [<int> x10], "current": [<int> x10]}

Usage:
    python serial_reader.py --port /dev/ttyUSB0 --baud 115200
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import queue
import threading
import time
from datetime import datetime, timezone

import serial
from pydantic import ValidationError

from app.database import SessionLocal
from app.schemas.energy_frame import EnergyFrameIngest
from app.services.ingest import persist_and_broadcast_frame
from app.services.processing import compute_power_samples

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SAMPLES = 10
MAX_FRAMES = 3

# ---------------------------------------------------------------------------
# Outbound write queue
# Callers outside the serial thread (e.g. REST handlers) put pre-encoded
# newline-terminated ASCII messages here.  _serial_thread drains it after
# each line it reads so messages are dispatched promptly.
# ---------------------------------------------------------------------------

_write_queue: queue.Queue = queue.Queue()


def enqueue_power_limit(mac: str, power_limit_watts: float) -> None:
    """Push a power-limit command to the controller over UART.

    Safe to call from any thread at any time; the message is delivered on
    the next iteration of the serial read loop.  If the port is currently
    disconnected the message is held in the queue and sent on reconnect.
    """
    msg = json.dumps({
        "type": "power_limit",
        "mac": mac,
        "power_limit_watts": power_limit_watts,
    }) + "\n"
    _write_queue.put(msg.encode("ascii"))
    logger.info("Queued power limit %.1f W for MAC %s", power_limit_watts, mac)


def handle_time_sync(ser: serial.Serial) -> bool:
    logger.info("Waiting for TIME_REQUEST from controller...")
    ser.timeout = 12
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
    ts = now.strftime('%Y-%m-%dT%H:%M:%S.') + f'{now.microsecond:06d}'
    response = json.dumps({"timestamp": ts}) + '\n'
    ser.write(response.encode('ascii'))
    ser.flush()

    logger.info("Time sync sent: %s", ts)
    ser.timeout = 1
    return True


# ---------------------------------------------------------------------------
# JSON line reader + parser (runs in executor thread)
# ---------------------------------------------------------------------------

def _read_line(ser: serial.Serial) -> str | None:
    """Read one newline-terminated line from the serial port. Returns None on timeout."""
    buf = b''
    while True:
        byte = ser.read(1)
        if not byte:
            return None
        if byte == b'\n':
            return buf.decode('ascii', errors='replace').strip()
        buf += byte


def parse_packet(line: str) -> dict | None:
    """Parse a JSON line from the controller into the internal packet dict."""
    try:
        pkt = json.loads(line)
    except json.JSONDecodeError as exc:
        logger.warning("parse: invalid JSON — %s | raw: %r", exc, line[:120])
        return None

    mac = pkt.get("mac")
    frames_raw = pkt.get("frames", [])

    if not isinstance(frames_raw, list) or not frames_raw:
        logger.warning("parse: missing or empty frames in packet from %s", mac)
        return None

    if len(frames_raw) > MAX_FRAMES:
        logger.warning("parse: frame_count=%d exceeds MAX_FRAMES=%d — dropping", len(frames_raw), MAX_FRAMES)
        return None

    frames = []
    for f in frames_raw:
        frames.append({
            "counter":    f.get("counter", 0),
            "tx_time_ms": f.get("tx_time_ms", ""),
            "current":    [c / 1000 for c in f.get("current", [])],
            "voltage":    [v / 1000 for v in f.get("voltage", [])],
        })

    return {
        "sender_id":   mac,
        "frame_count": len(frames),
        "frames":      frames,
    }


# ---------------------------------------------------------------------------
# Frame processor (consumes queue)
# ---------------------------------------------------------------------------

async def process_frames(queue: asyncio.Queue) -> None:
    while True:
        frame = await queue.get()
        try:
            mac_address = str(frame["sender_id"])

            try:
                timestamp = datetime.fromisoformat(frame["tx_time_ms"])
            except (KeyError, ValueError, TypeError):
                logger.warning(
                    "Bad timestamp %r on MAC %s counter=%d, using server time",
                    frame.get("tx_time_ms"), mac_address, frame["counter"],
                )
                timestamp = datetime.now(timezone.utc)

            try:
                ingest = EnergyFrameIngest(
                    mac_address=mac_address,
                    timestamp=timestamp,
                    voltage_samples=frame["voltage"],
                    current_samples=frame["current"],
                )
            except ValidationError as exc:
                logger.warning(
                    "Schema validation failed for MAC %s counter=%d: %s",
                    mac_address, frame["counter"], exc,
                )
                continue

            processed = {
                "mac_address":     ingest.mac_address,
                "timestamp":       ingest.timestamp,
                "voltage_samples": ingest.voltage_samples,
                "current_samples": ingest.current_samples,
                "power_samples":   compute_power_samples(ingest.voltage_samples, ingest.current_samples),
            }

            db = SessionLocal()
            try:
                _, created = await persist_and_broadcast_frame(db, processed)
                if created:
                    logger.info(
                        "Frame saved — MAC %s  counter=%d  esp_ts=%s  peak_W=%.2f",
                        mac_address,
                        frame["counter"],
                        frame.get("tx_time_ms", "?"),
                        max(processed["power_samples"]),
                    )
                else:
                    logger.debug(
                        "Duplicate frame skipped — MAC %s  counter=%d",
                        mac_address, frame["counter"],
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

def _serial_thread(port: str, baud: int, out: queue.Queue) -> None:
    """Runs entirely in a background thread. Puts parsed frames onto out."""
    while True:
        ser = None
        while ser is None:
            try:
                logger.info("Opening %s at %d baud", port, baud)
                ser = serial.Serial(port, baud, timeout=1)
                ser.setRTS(False)
                ser.setDTR(False)
            except serial.SerialException:
                logger.info("Port %s not available, retrying in 3s...", port)
                time.sleep(3)

        try:
            if not handle_time_sync(ser):
                logger.warning("Time sync failed — ECU timestamps will be epoch")
        except serial.SerialException as exc:
            logger.error("Time sync error: %s — reconnecting", exc)
            ser.close()
            continue

        logger.info("Listening for JSON packets...")
        try:
            while True:
                line = _read_line(ser)
                if not line:
                    continue
                if not line.startswith('{'):
                    if 'TIME_REQUEST' in line:
                        now = datetime.now(timezone.utc)
                        ts = now.strftime('%Y-%m-%dT%H:%M:%S.') + f'{now.microsecond:06d}'
                        response = json.dumps({"timestamp": ts}) + '\n'
                        ser.write(response.encode('ascii'))
                        ser.flush()
                        logger.info("Time sync sent: %s", ts)
                    else:
                        logger.debug("RX non-JSON: %r", line[:120])
                    continue
                packet = parse_packet(line)
                if packet is None:
                    continue
                for frame in packet["frames"]:
                    frame["sender_id"] = packet["sender_id"]
                    out.put(frame)

                while not _write_queue.empty():
                    try:
                        ser.write(_write_queue.get_nowait())
                        ser.flush()
                    except queue.Empty:
                        break
        except Exception as exc:
            logger.error("Serial thread error: %s", exc)
        finally:
            ser.close()
            logger.info("Port closed, reconnecting...")


async def run(port: str, baud: int) -> None:
    raw_queue: queue.Queue = queue.Queue()
    async_queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    # Serial runs in a real OS thread — never touches the event loop
    thread = threading.Thread(target=_serial_thread, args=(port, baud, raw_queue), daemon=True)
    thread.start()

    # Bridge: moves frames from thread-safe queue → asyncio queue
    async def bridge() -> None:
        while True:
            try:
                frame = await loop.run_in_executor(None, raw_queue.get)
                if frame is None:  # sentinel — serial thread died
                    logger.error("Serial thread exited, stopping")
                    return
                await async_queue.put(frame)
            except Exception as exc:
                logger.error("Bridge error: %s", exc)

    await asyncio.gather(
        bridge(),
        process_frames(async_queue),
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description="EVolocity serial frame reader")
    parser.add_argument("--port", required=True, help="Serial port e.g. COM3")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    await run(args.port, args.baud)


if __name__ == "__main__":
    asyncio.run(main())
