# Unit tests for firmware update endpoints (routers/firmware.py).

import pytest

import app.routers.firmware as firmware_module
from app.models.ecu import ECU, VehicleClass, VehicleType

MAGIC_BYTE = bytes([0xE9])
VALID_BIN = MAGIC_BYTE + b"\x00" * 100


def make_ecu(db, mac_address="AA:BB:CC:DD:EE:01"):
    ecu = ECU(
        mac_address=mac_address,
        team_number=1,
        vehicle_class=VehicleClass.STANDARD,
        vehicle_type=VehicleType.BIKE,
        power_limit_watts=350.0,
    )
    db.add(ecu)
    db.commit()
    db.refresh(ecu)
    return ecu


@pytest.fixture(autouse=True)
def clear_firmware_state(tmp_path):
    firmware_module._jobs.clear()
    original_dir = firmware_module.FIRMWARE_DIR
    firmware_module.FIRMWARE_DIR = tmp_path
    yield
    firmware_module._jobs.clear()
    firmware_module.FIRMWARE_DIR = original_dir


class TestUploadFirmware:
    def test_returns_404_when_ecu_not_found(self, client):
        resp = client.post(
            "/api/9999/firmware",
            files={"file": ("fw.bin", VALID_BIN, "application/octet-stream")},
        )
        assert resp.status_code == 404

    def test_rejects_non_bin_extension(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(
            f"/api/{ecu.id}/firmware",
            files={"file": ("fw.txt", VALID_BIN, "application/octet-stream")},
        )
        assert resp.status_code == 415

    def test_rejects_empty_file(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(
            f"/api/{ecu.id}/firmware",
            files={"file": ("fw.bin", b"", "application/octet-stream")},
        )
        assert resp.status_code == 400

    def test_rejects_invalid_magic_byte(self, client, db):
        ecu = make_ecu(db)
        bad_firmware = b"\x00" * 101
        resp = client.post(
            f"/api/{ecu.id}/firmware",
            files={"file": ("fw.bin", bad_firmware, "application/octet-stream")},
        )
        assert resp.status_code == 422

    def test_accepts_valid_firmware(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(
            f"/api/{ecu.id}/firmware",
            files={"file": ("fw.bin", VALID_BIN, "application/octet-stream")},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["ecu_id"] == ecu.id
        assert body["status"] == "pending"

    def test_response_contains_checksum(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(
            f"/api/{ecu.id}/firmware",
            files={"file": ("fw.bin", VALID_BIN, "application/octet-stream")},
        )
        assert resp.json()["checksum_sha256"] is not None

    def test_response_contains_size_bytes(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(
            f"/api/{ecu.id}/firmware",
            files={"file": ("fw.bin", VALID_BIN, "application/octet-stream")},
        )
        assert resp.json()["size_bytes"] == len(VALID_BIN)


class TestGetFirmwareStatus:
    def test_returns_idle_when_no_job(self, client, db):
        ecu = make_ecu(db)
        resp = client.get(f"/api/{ecu.id}/firmware/status")
        assert resp.status_code == 200
        assert resp.json()["status"] == "idle"

    def test_returns_pending_after_upload(self, client, db):
        ecu = make_ecu(db)
        client.post(
            f"/api/{ecu.id}/firmware",
            files={"file": ("fw.bin", VALID_BIN, "application/octet-stream")},
        )
        resp = client.get(f"/api/{ecu.id}/firmware/status")
        assert resp.json()["status"] == "pending"

    def test_returns_404_when_ecu_not_found(self, client):
        resp = client.get("/api/9999/firmware/status")
        assert resp.status_code == 404


class TestReportFirmwareProgress:
    def test_updates_progress(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(
            f"/api/{ecu.id}/firmware/status",
            json={"status": "downloading", "progress": 50},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "downloading"
        assert resp.json()["progress"] == 50

    def test_success_sets_progress_to_100(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(
            f"/api/{ecu.id}/firmware/status",
            json={"status": "success", "progress": 80, "firmware_version": "1.2.3"},
        )
        assert resp.json()["progress"] == 100

    def test_success_persists_firmware_version_to_ecu(self, client, db):
        ecu = make_ecu(db)
        client.post(
            f"/api/{ecu.id}/firmware/status",
            json={"status": "success", "progress": 100, "firmware_version": "2.0.0"},
        )
        ecu_resp = client.get(f"/api/ecu/{ecu.id}").json()
        assert ecu_resp["firmware_version"] == "2.0.0"

    def test_failed_status_sets_error_message(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(
            f"/api/{ecu.id}/firmware/status",
            json={"status": "failed", "progress": 30, "error_message": "flash error"},
        )
        assert resp.json()["status"] == "failed"
        assert resp.json()["error_message"] == "flash error"

    def test_returns_404_when_ecu_not_found(self, client):
        resp = client.post(
            "/api/9999/firmware/status",
            json={"status": "downloading", "progress": 10},
        )
        assert resp.status_code == 404
