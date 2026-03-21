"""
Simulates an ESP32 sending energy frames to the backend every 0.1 seconds.
Run this while the backend server is running to test the data pipeline.

Usage: python simulate_esp32.py
"""

import random
import time
from datetime import datetime, timezone

import requests

BACKEND_URL = "http://localhost:8000/api/data"
ECU_SERIAL = 12345
INTERVAL = 0.1  # seconds
NUM_SAMPLES = 10  # ADC samples per frame


def random_adc_samples(center: int, spread: int) -> list[int]:
    return [
        max(0, min(4095, center + random.randint(-spread, spread)))
        for _ in range(NUM_SAMPLES)
    ]


def send_frame(energy_accumulator: float) -> float:
    # Simulate ~50V battery, ~5A current
    voltage_samples = random_adc_samples(center=2800, spread=50)
    current_samples = random_adc_samples(center=1800, spread=100)

    # Rough energy estimate (Wh) since last frame
    avg_v = (sum(voltage_samples) / len(voltage_samples) / 4095) * 3.3 * 18.18
    avg_a = ((sum(current_samples) / len(current_samples) / 4095) * 3.3 - 1.65) / 0.066
    energy_delta = (avg_v * avg_a * INTERVAL) / 3600
    energy_accumulator += energy_delta

    payload = {
        "ecu_serial": ECU_SERIAL,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "voltage_samples": voltage_samples,
        "current_samples": current_samples,
        "energy": round(energy_accumulator, 6),
    }

    try:
        resp = requests.post(BACKEND_URL, json=payload, timeout=2)
        print(f"[{payload['timestamp']}] status={resp.status_code} | avg_v={avg_v:.2f}V avg_a={avg_a:.2f}A")
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")

    return energy_accumulator


if __name__ == "__main__":
    print(f"Simulating ESP32 (serial={ECU_SERIAL}) → {BACKEND_URL}")
    print("Press Ctrl+C to stop\n")
    energy = 0.0
    while True:
        energy = send_frame(energy)
        time.sleep(INTERVAL)
