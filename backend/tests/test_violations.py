# Unit tests for violation endpoints (routers/violations.py).

from datetime import datetime

from app.models.ecu import ECU, VehicleClass, VehicleType
from app.models.power_violation_event import PowerViolationEvent


def make_ecu(db, serial_number=1001):
    ecu = ECU(
        serial_number=serial_number,
        team_number=1,
        vehicle_class=VehicleClass.STANDARD,
        vehicle_type=VehicleType.BIKE,
        power_limit_watts=350.0,
    )
    db.add(ecu)
    db.commit()
    db.refresh(ecu)
    return ecu


def make_violation(db, ecu_id, start="2024-01-01T12:00:00+00:00", end=None, is_warning=True):
    start_dt = datetime.fromisoformat(start)
    event = PowerViolationEvent(
        ecu_id=ecu_id,
        start_timestamp=start_dt,
        last_over_timestamp=start_dt,
        end_timestamp=datetime.fromisoformat(end) if end else None,
        duration_seconds=0.0,
        penalty_seconds=0.0,
        limit_watts=350.0,
        peak_power_watts=400.0,
        frame_count=1,
        is_warning=is_warning,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


class TestListViolations:
    def test_returns_empty_list_when_no_violations(self, client):
        resp = client.get("/api/violations/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_all_violations(self, client, db):
        ecu = make_ecu(db)
        make_violation(db, ecu.id)
        resp = client.get("/api/violations/")
        assert len(resp.json()) == 1

    def test_filters_by_ecu_id(self, client, db):
        ecu1 = make_ecu(db, serial_number=1001)
        ecu2 = make_ecu(db, serial_number=1002)
        make_violation(db, ecu1.id)
        make_violation(db, ecu2.id)
        events = client.get(f"/api/violations/?ecu_id={ecu1.id}").json()
        assert len(events) == 1
        assert events[0]["ecu_id"] == ecu1.id

    def test_open_only_excludes_closed_events(self, client, db):
        ecu = make_ecu(db)
        make_violation(db, ecu.id, end="2024-01-01T12:00:05+00:00")
        make_violation(db, ecu.id, start="2024-01-01T12:00:10+00:00")
        events = client.get("/api/violations/?open_only=true").json()
        assert len(events) == 1
        assert events[0]["end_timestamp"] is None

    def test_respects_limit_parameter(self, client, db):
        ecu = make_ecu(db)
        for i in range(5):
            make_violation(db, ecu.id, start=f"2024-01-01T12:00:0{i}+00:00")
        assert len(client.get("/api/violations/?limit=2").json()) == 2

    def test_response_contains_expected_fields(self, client, db):
        ecu = make_ecu(db)
        make_violation(db, ecu.id)
        event = client.get("/api/violations/").json()[0]
        for field in ("id", "ecu_id", "peak_power_watts", "limit_watts", "is_warning"):
            assert field in event


class TestGetViolationById:
    def test_returns_violation_when_found(self, client, db):
        ecu = make_ecu(db)
        event = make_violation(db, ecu.id)
        resp = client.get(f"/api/violations/{event.id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == event.id

    def test_returns_404_when_not_found(self, client):
        assert client.get("/api/violations/9999").status_code == 404

    def test_response_links_to_correct_ecu(self, client, db):
        ecu = make_ecu(db)
        event = make_violation(db, ecu.id)
        assert client.get(f"/api/violations/{event.id}").json()["ecu_id"] == ecu.id

    def test_closed_event_has_end_timestamp(self, client, db):
        ecu = make_ecu(db)
        event = make_violation(db, ecu.id, end="2024-01-01T12:00:05+00:00")
        assert client.get(f"/api/violations/{event.id}").json()["end_timestamp"] is not None

    def test_open_event_has_null_end_timestamp(self, client, db):
        ecu = make_ecu(db)
        event = make_violation(db, ecu.id)
        assert client.get(f"/api/violations/{event.id}").json()["end_timestamp"] is None
