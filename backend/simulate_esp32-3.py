"""
Simulates a third ESP32 that cycles through a scripted violation pattern
to exercise the full notification pipeline:

  Phase 1 — 5 s  below limit  (P ≈ -124 W)  → no alert
  Phase 2 — 2.5 s over limit  (P ≈  377 W)  → warning toast (frame 1),
                                               escalated → red dot (after 1 s)
  Phase 3 — 5 s  below limit  (P ≈ -124 W)  → resolved: log entry, dot clears
  (repeat)

Usage: python simulate_esp32-3.py
"""

import random
import time
from datetime import datetime, timezone

import requests

BACKEND_URL = "http://localhost:8000/api/data"
MAC_ADDRESS = "AA:BB:CC:DD:EE:03"
INTERVAL    = 0.1   # seconds per frame
NUM_SAMPLES = 10    # ADC samples per frame

# ADC centres — voltage stays constant; current switches between phases
VOLTAGE_CENTER  = 2800          # ≈ 41 V
CURRENT_NORMAL  = 1800          # ≈ -3 A  → P ≈ -124 W  (below 350 W limit)
CURRENT_VIOLATE = 2800          # ≈  9 A  → P ≈  377 W  (above 350 W limit)

# Phase durations in frames (1 frame = 0.1 s)
FRAMES_NORMAL  = 50   # 5 s
FRAMES_VIOLATE = 25   # 2.5 s  (backend escalates after 10 frames / 1 s)


def adc_samples(center: int, spread: int = 50) -> list[int]:
    return [max(0, min(4095, center + random.randint(-spread, spread)))
            for _ in range(NUM_SAMPLES)]


def send_frame(current_center: int) -> int:
    v_samples = adc_samples(VOLTAGE_CENTER, spread=50)
    i_samples = adc_samples(current_center, spread=100)

    payload = {
        "mac_address": MAC_ADDRESS,
        "timestamp":   datetime.now(timezone.utc).isoformat(),
        "voltage_samples": v_samples,
        "current_samples": i_samples,
    }

    try:
        resp = requests.post(BACKEND_URL, json=payload, timeout=2)
        avg_v = (sum(v_samples) / NUM_SAMPLES / 4095) * 3.3 * 18.18
        avg_a = ((sum(i_samples) / NUM_SAMPLES / 4095) * 3.3 - 1.65) / 0.066
        return resp.status_code, avg_v, avg_a
    except requests.exceptions.RequestException as e:
        print(f"  Request failed: {e}")
        return None, 0, 0


def run_phase(label: str, current_center: int, num_frames: int) -> None:
    print(f"\n{'─'*55}")
    print(f"  PHASE: {label}")
    print(f"{'─'*55}")
    for _ in range(num_frames):
        status, v, a = send_frame(current_center)
        ts = datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3]
        p = v * a
        print(f"  [{ts}] status={status}  {v:.1f}V  {a:+.2f}A  {p:+.0f}W")
        time.sleep(INTERVAL)


if __name__ == "__main__":
    print(f"Violation-cycle simulator  mac={MAC_ADDRESS}  →  {BACKEND_URL}")
    print(f"Pattern: {FRAMES_NORMAL} frames normal → {FRAMES_VIOLATE} frames over limit → repeat")
    print("Press Ctrl+C to stop\n")

    cycle = 0
    while True:
        cycle += 1
        print(f"\n{'═'*55}")
        print(f"  CYCLE {cycle}")
        print(f"{'═'*55}")

        run_phase("NORMAL   (P ≈ -124 W, no violation)", CURRENT_NORMAL,  FRAMES_NORMAL)
        run_phase("VIOLATE  (P ≈  377 W, > 350 W limit)", CURRENT_VIOLATE, FRAMES_VIOLATE)
        run_phase("RESOLVED (back below limit)", CURRENT_NORMAL,  FRAMES_NORMAL)
