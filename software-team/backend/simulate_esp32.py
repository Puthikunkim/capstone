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
MAC_ADDRESS = "AA:BB:CC:DD:EE:01"
INTERVAL = 0.1  # seconds
NUM_SAMPLES = 10  # ADC samples per frame


def random_adc_samples(center: int, spread: int) -> list[int]:
    return [
        max(0, min(4095, center + random.randint(-spread, spread)))
        for _ in range(NUM_SAMPLES)
    ]


def send_frame() -> None:
    # Simulate ~50V battery, ~5A current as raw 12-bit ADC values
    voltage_samples = random_adc_samples(center=2800, spread=50)
    current_samples = random_adc_samples(center=1800, spread=100)

    payload = {
        "mac_address": MAC_ADDRESS,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "voltage_samples": voltage_samples,
        "current_samples": current_samples,
    }

    try:
        resp = requests.post(BACKEND_URL, json=payload, timeout=2)
        avg_v = (sum(voltage_samples) / NUM_SAMPLES / 4095) * 3.3 * 18.18
        avg_a = ((sum(current_samples) / NUM_SAMPLES / 4095) * 3.3 - 1.65) / 0.066
        print(f"[{payload['timestamp']}] status={resp.status_code} | avg_v={avg_v:.2f}V avg_a={avg_a:.2f}A")
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")


if __name__ == "__main__":
    print(f"Simulating ESP32 (mac={MAC_ADDRESS}) → {BACKEND_URL}")
    print("Press Ctrl+C to stop\n")
    while True:
        send_frame()
        time.sleep(INTERVAL)
