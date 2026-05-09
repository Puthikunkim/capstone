# Unit tests for ECU management endpoints (routers/ecu.py).

from datetime import datetime

from app.models.ecu import ECU, VehicleClass, VehicleType
from app.models.energy_frame import EnergyFrame


def make_ecu(db, serial_number=1001, team_number=1, power_limit_watts=350.0):
    ecu = ECU(
        serial_number=serial_number,
        team_number=team_number,
        vehicle_class=VehicleClass.STANDARD,
        vehicle_type=VehicleType.BIKE,
        power_limit_watts=power_limit_watts,
    )
    db.add(ecu)
    db.commit()
    db.refresh(ecu)
    return ecu


def make_frame(db, ecu_id, timestamp_str="2024-01-01T12:00:00+00:00"):
    frame = EnergyFrame(
        ecu_id=ecu_id,
        timestamp=datetime.fromisoformat(timestamp_str),
        avg_voltage=41.0,
        avg_current=-3.0,
        power_watts=-123.0,
        energy=-3.0,
    )
    db.add(frame)
    db.commit()
    db.refresh(frame)
    return frame


class TestListEcus:
    def test_returns_empty_list_when_no_ecus(self, client):
        resp = client.get("/api/ecu/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_all_ecus(self, client, db):
        make_ecu(db, serial_number=1001)
        make_ecu(db, serial_number=1002)
        resp = client.get("/api/ecu/")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_response_contains_expected_fields(self, client, db):
        make_ecu(db, serial_number=9999)
        ecu = client.get("/api/ecu/").json()[0]
        assert ecu["serial_number"] == "9999"
        assert "id" in ecu
        assert "is_connected" in ecu


class TestGetEcu:
    def test_returns_ecu_by_id(self, client, db):
        ecu = make_ecu(db)
        resp = client.get(f"/api/ecu/{ecu.id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == ecu.id

    def test_returns_correct_serial_number(self, client, db):
        ecu = make_ecu(db, serial_number=5555)
        resp = client.get(f"/api/ecu/{ecu.id}")
        assert resp.json()["serial_number"] == "5555"

    def test_returns_404_when_not_found(self, client):
        resp = client.get("/api/ecu/9999")
        assert resp.status_code == 404


class TestConfigureEcu:
    def test_updates_team_number(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(f"/api/ecu/{ecu.id}/configure", json={"team_number": 42})
        assert resp.status_code == 200
        assert resp.json()["team_number"] == 42

    def test_power_limit_cannot_be_changed_via_configure(self, client, db):
        ecu = make_ecu(db, power_limit_watts=350.0)
        resp = client.post(f"/api/ecu/{ecu.id}/configure", json={"power_limit_watts": 2000.0})
        assert resp.status_code == 200
        assert resp.json()["power_limit_watts"] == 350.0

    def test_updates_vehicle_class(self, client, db):
        ecu = make_ecu(db)
        resp = client.post(f"/api/ecu/{ecu.id}/configure", json={"vehicle_class": "Open"})
        assert resp.status_code == 200
        assert resp.json()["vehicle_class"] == "Open"
        assert resp.json()["power_limit_watts"] == 2000.0

    def test_changing_to_standard_class_sets_350w_limit(self, client, db):
        ecu = make_ecu(db, power_limit_watts=2000.0)
        resp = client.post(f"/api/ecu/{ecu.id}/configure", json={"vehicle_class": "Standard"})
        assert resp.status_code == 200
        assert resp.json()["power_limit_watts"] == 350.0

    def test_returns_404_when_not_found(self, client):
        resp = client.post("/api/ecu/9999/configure", json={"team_number": 1})
        assert resp.status_code == 404

    def test_partial_update_preserves_other_fields(self, client, db):
        ecu = make_ecu(db, team_number=5, power_limit_watts=500.0)
        resp = client.post(f"/api/ecu/{ecu.id}/configure", json={"team_number": 10})
        assert resp.status_code == 200
        body = resp.json()
        assert body["team_number"] == 10
        assert body["power_limit_watts"] == 500.0


class TestGetEcuHistory:
    def test_returns_empty_list_when_no_frames(self, client, db):
        ecu = make_ecu(db)
        resp = client.get(f"/api/ecu/{ecu.id}/history")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_frames_for_ecu(self, client, db):
        ecu = make_ecu(db)
        make_frame(db, ecu.id)
        resp = client.get(f"/api/ecu/{ecu.id}/history")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_returns_404_when_ecu_not_found(self, client):
        resp = client.get("/api/ecu/9999/history")
        assert resp.status_code == 404

    def test_respects_limit_parameter(self, client, db):
        ecu = make_ecu(db)
        for i in range(5):
            make_frame(db, ecu.id, f"2024-01-01T12:00:0{i}+00:00")
        resp = client.get(f"/api/ecu/{ecu.id}/history?limit=2")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_returns_frames_in_chronological_order(self, client, db):
        ecu = make_ecu(db)
        make_frame(db, ecu.id, "2024-01-01T12:00:05+00:00")
        make_frame(db, ecu.id, "2024-01-01T12:00:01+00:00")
        frames = client.get(f"/api/ecu/{ecu.id}/history").json()
        timestamps = [f["timestamp"] for f in frames]
        assert timestamps == sorted(timestamps)

    def test_does_not_return_frames_from_other_ecus(self, client, db):
        ecu1 = make_ecu(db, serial_number=1001)
        ecu2 = make_ecu(db, serial_number=1002)
        make_frame(db, ecu2.id)
        resp = client.get(f"/api/ecu/{ecu1.id}/history")
        assert resp.json() == []
