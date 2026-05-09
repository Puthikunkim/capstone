# Unit tests for scoring endpoints (routers/scoring.py).

from datetime import datetime

from app.models.ecu import ECU, VehicleClass, VehicleType
from app.models.energy_frame import EnergyFrame

START = "2024-01-01T12:00:00Z"
END = "2024-01-01T13:00:00Z"
SHORT_START = "2024-01-01T12:00:00Z"
SHORT_END = "2024-01-01T12:00:20Z"


def make_ecu(db, serial_number=1001, vehicle_class=VehicleClass.STANDARD, vehicle_type=VehicleType.BIKE):
    ecu = ECU(
        serial_number=serial_number,
        team_number=1,
        vehicle_class=vehicle_class,
        vehicle_type=vehicle_type,
        power_limit_watts=350.0,
    )
    db.add(ecu)
    db.commit()
    db.refresh(ecu)
    return ecu


def make_frame(db, ecu_id, timestamp_str, power_watts=100.0, energy=0.1):
    frame = EnergyFrame(
        ecu_id=ecu_id,
        timestamp=datetime.fromisoformat(timestamp_str),
        avg_voltage=41.0,
        avg_current=power_watts / 41.0,
        power_watts=power_watts,
        energy=energy,
    )
    db.add(frame)
    db.commit()
    db.refresh(frame)
    return frame


class TestGetEventScoring:
    def test_returns_200_with_no_ecus(self, client):
        resp = client.get(f"/api/scoring/event/evt1?start={START}&end={END}")
        assert resp.status_code == 200

    def test_returns_empty_brackets_when_no_ecus(self, client):
        resp = client.get(f"/api/scoring/event/evt1?start={START}&end={END}")
        assert resp.json()["brackets"] == []

    def test_returns_400_when_end_before_start(self, client):
        resp = client.get(f"/api/scoring/event/evt1?start={END}&end={START}")
        assert resp.status_code == 400

    def test_event_id_reflected_in_response(self, client):
        resp = client.get(f"/api/scoring/event/my_event?start={START}&end={END}")
        assert resp.json()["event_id"] == "my_event"

    def test_ecu_with_frames_appears_in_bracket(self, client, db):
        ecu = make_ecu(db)
        make_frame(db, ecu.id, "2024-01-01T12:30:00+00:00")
        resp = client.get(f"/api/scoring/event/evt1?start={START}&end={END}")
        brackets = resp.json()["brackets"]
        assert len(brackets) == 1
        assert len(brackets[0]["entries"]) == 1

    def test_ecu_without_frames_excluded_by_default(self, client, db):
        make_ecu(db)
        resp = client.get(f"/api/scoring/event/evt1?start={START}&end={END}")
        assert resp.json()["brackets"] == []

    def test_ecu_without_frames_included_when_include_inactive(self, client, db):
        make_ecu(db)
        resp = client.get(f"/api/scoring/event/evt1?start={START}&end={END}&include_inactive=true")
        brackets = resp.json()["brackets"]
        assert len(brackets) == 1
        assert brackets[0]["entries"][0]["status"] == "dnf"

    def test_entry_has_expected_fields(self, client, db):
        ecu = make_ecu(db)
        make_frame(db, ecu.id, "2024-01-01T12:30:00+00:00")
        entry = client.get(f"/api/scoring/event/evt1?start={START}&end={END}").json()["brackets"][0]["entries"][0]
        for field in ("rank", "ecu_id", "team_number", "status", "score", "frame_count"):
            assert field in entry

    def test_two_ecus_in_same_bracket(self, client, db):
        ecu1 = make_ecu(db, serial_number=1001)
        ecu2 = make_ecu(db, serial_number=1002)
        make_frame(db, ecu1.id, "2024-01-01T12:30:00+00:00", power_watts=100.0)
        make_frame(db, ecu2.id, "2024-01-01T12:30:00+00:00", power_watts=200.0)
        resp = client.get(f"/api/scoring/event/evt1?start={START}&end={END}")
        assert len(resp.json()["brackets"][0]["entries"]) == 2

    def test_ecus_split_into_different_brackets_by_class(self, client, db):
        ecu_std = make_ecu(db, serial_number=1001, vehicle_class=VehicleClass.STANDARD)
        ecu_open = make_ecu(db, serial_number=1002, vehicle_class=VehicleClass.OPEN)
        make_frame(db, ecu_std.id, "2024-01-01T12:30:00+00:00")
        make_frame(db, ecu_open.id, "2024-01-01T12:30:00+00:00")
        resp = client.get(f"/api/scoring/event/evt1?start={START}&end={END}")
        assert len(resp.json()["brackets"]) == 2

    def test_lower_energy_ranks_first(self, client, db):
        ecu1 = make_ecu(db, serial_number=1001)
        ecu2 = make_ecu(db, serial_number=1002)
        make_frame(db, ecu1.id, "2024-01-01T12:30:00+00:00", energy=0.5)
        make_frame(db, ecu2.id, "2024-01-01T12:30:01+00:00", energy=1.0)
        entries = client.get(f"/api/scoring/event/evt1?start={START}&end={END}").json()["brackets"][0]["entries"]
        assert entries[0]["ecu_id"] == ecu1.id
        assert entries[0]["rank"] == 1


class TestEfficiencyLeaderboard:
    def test_returns_200(self, client):
        resp = client.get(f"/api/scoring/efficiency-leaderboard/evt1?start={SHORT_START}&end={SHORT_END}")
        assert resp.status_code == 200

    def test_returns_400_when_end_before_start(self, client):
        resp = client.get(f"/api/scoring/efficiency-leaderboard/evt1?start={END}&end={START}")
        assert resp.status_code == 400

    def test_returns_400_when_window_exceeds_30_seconds(self, client):
        resp = client.get(
            "/api/scoring/efficiency-leaderboard/evt1"
            "?start=2024-01-01T12:00:00Z&end=2024-01-01T12:01:00Z"
        )
        assert resp.status_code == 400

    def test_accepts_window_at_exactly_30_seconds(self, client):
        resp = client.get(
            "/api/scoring/efficiency-leaderboard/evt1"
            "?start=2024-01-01T12:00:00Z&end=2024-01-01T12:00:30Z"
        )
        assert resp.status_code == 200

    def test_uses_integrated_power_energy_source(self, client):
        resp = client.get(f"/api/scoring/efficiency-leaderboard/evt1?start={SHORT_START}&end={SHORT_END}")
        assert resp.json()["energy_source"] == "integrated_power"
