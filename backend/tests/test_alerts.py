# Unit tests for alert endpoints (routers/alerts.py)

from datetime import datetime, timezone

from app.models.alert import Alert
from app.models.ecu import ECU, VehicleClass, VehicleType
from app.models.energy_frame import EnergyFrame


def make_ecu(db, mac_address="AA:BB:CC:DD:EE:01", power_limit_watts=350.0):
    ecu = ECU(
        mac_address=mac_address,
        team_number=1,
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
        avg_current=10.0,
        power_watts=410.0,
        energy=3.0,
    )
    db.add(frame)
    db.commit()
    db.refresh(frame)
    return frame


def make_alert(db, ecu_id, frame_id, power_watts=410.0, limit_watts=350.0):
    alert = Alert(
        ecu_id=ecu_id,
        timestamp=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
        power_watts=power_watts,
        limit_watts=limit_watts,
        frame_id=frame_id,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return alert


class TestListAlerts:
    def test_returns_empty_list_when_no_alerts(self, client):
        resp = client.get("/api/alerts/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_all_alerts(self, client, db):
        ecu = make_ecu(db)
        frame = make_frame(db, ecu.id)
        make_alert(db, ecu.id, frame.id)
        resp = client.get("/api/alerts/")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_filters_by_ecu_id(self, client, db):
        ecu1 = make_ecu(db, mac_address="AA:BB:CC:DD:EE:01")
        ecu2 = make_ecu(db, mac_address="AA:BB:CC:DD:EE:02")
        frame1 = make_frame(db, ecu1.id)
        frame2 = make_frame(db, ecu2.id)
        make_alert(db, ecu1.id, frame1.id)
        make_alert(db, ecu2.id, frame2.id)
        resp = client.get(f"/api/alerts/?ecu_id={ecu1.id}")
        alerts = resp.json()
        assert len(alerts) == 1
        assert alerts[0]["ecu_id"] == ecu1.id

    def test_respects_limit_parameter(self, client, db):
        ecu = make_ecu(db)
        for i in range(5):
            frame = make_frame(db, ecu.id, f"2024-01-01T12:00:0{i}+00:00")
            make_alert(db, ecu.id, frame.id)
        resp = client.get("/api/alerts/?limit=2")
        assert len(resp.json()) == 2


class TestGetAlertById:
    def test_returns_alert_when_found(self, client, db):
        ecu = make_ecu(db)
        frame = make_frame(db, ecu.id)
        alert = make_alert(db, ecu.id, frame.id)
        resp = client.get(f"/api/alerts/{alert.id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == alert.id

    def test_returns_404_when_not_found(self, client):
        resp = client.get("/api/alerts/9999")
        assert resp.status_code == 404

    def test_response_contains_power_and_limit(self, client, db):
        ecu = make_ecu(db)
        frame = make_frame(db, ecu.id)
        alert = make_alert(db, ecu.id, frame.id, power_watts=410.0, limit_watts=350.0)
        body = client.get(f"/api/alerts/{alert.id}").json()
        assert body["power_watts"] == 410.0
        assert body["limit_watts"] == 350.0

    def test_response_links_to_correct_ecu(self, client, db):
        ecu = make_ecu(db)
        frame = make_frame(db, ecu.id)
        alert = make_alert(db, ecu.id, frame.id)
        body = client.get(f"/api/alerts/{alert.id}").json()
        assert body["ecu_id"] == ecu.id
