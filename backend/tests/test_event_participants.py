from datetime import datetime, timedelta, timezone

import pytest

from app.models.competition import Competition, CompetitionEvent, CompetitionEventType
from app.models.ecu import ECU, VehicleClass, VehicleType
from app.models.energy_frame import EnergyFrame
from app.models.event_participant import EventParticipant
from app.models.team import Team


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_competition(db, name="Round 1", event_types=None):
    comp = Competition(name=name)
    db.add(comp)
    db.flush()
    for et in (event_types or [CompetitionEventType.DRAG_RACE]):
        db.add(CompetitionEvent(competition_id=comp.id, event_type=et))
    db.commit()
    db.refresh(comp)
    return comp


def make_team(db, name="Team Alpha", competition_id=None):
    team = Team(
        name=name,
        vehicle_class=VehicleClass.STANDARD,
        vehicle_type=VehicleType.BIKE,
        competition_id=competition_id,
    )
    db.add(team)
    db.commit()
    db.refresh(team)
    return team


def make_event(db, competition_id, event_type=CompetitionEventType.DRAG_RACE):
    event = CompetitionEvent(competition_id=competition_id, event_type=event_type)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def make_participant(db, team_id, event_id, start=None, duration_seconds=None):
    p = EventParticipant(team_id=team_id, event_id=event_id, start=start, duration_seconds=duration_seconds)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def make_ecu(db, mac="AA:BB:CC:DD:EE:01", team_id=None):
    ecu = ECU(
        mac_address=mac,
        team_number=0,
        vehicle_class=VehicleClass.STANDARD,
        vehicle_type=VehicleType.BIKE,
        power_limit_watts=350.0,
        team_id=team_id,
    )
    db.add(ecu)
    db.commit()
    db.refresh(ecu)
    return ecu


def make_frame(db, ecu_id, team_id=None, timestamp_str="2024-01-01T12:00:00+00:00"):
    frame = EnergyFrame(
        ecu_id=ecu_id,
        team_id=team_id,
        timestamp=datetime.fromisoformat(timestamp_str),
        avg_voltage=41.0,
        avg_current=3.0,
        power_watts=123.0,
        energy=1.0,
    )
    db.add(frame)
    db.commit()
    db.refresh(frame)
    return frame


# ---------------------------------------------------------------------------
# Event participant CRUD
# ---------------------------------------------------------------------------

class TestCreateEventParticipant:
    def test_creates_with_no_start_or_duration(self, client, db):
        comp = make_competition(db)
        event = comp.events[0]
        team = make_team(db)

        resp = client.post("/api/event-participants/", json={
            "team_id": team.id,
            "event_id": event.id,
        })
        assert resp.status_code == 201
        body = resp.json()
        assert body["team_id"] == team.id
        assert body["event_id"] == event.id
        assert body["start"] is None
        assert body["duration_seconds"] is None
        assert body["end"] is None

    def test_creates_with_start_and_duration(self, client, db):
        comp = make_competition(db)
        event = comp.events[0]
        team = make_team(db)

        resp = client.post("/api/event-participants/", json={
            "team_id": team.id,
            "event_id": event.id,
            "start": "2024-06-01T09:00:00+00:00",
            "duration_seconds": 3600.0,
        })
        assert resp.status_code == 201
        body = resp.json()
        assert body["start"] is not None
        assert body["duration_seconds"] == pytest.approx(3600.0)
        assert body["end"] is not None

    def test_end_is_start_plus_duration(self, client, db):
        comp = make_competition(db)
        event = comp.events[0]
        team = make_team(db)

        resp = client.post("/api/event-participants/", json={
            "team_id": team.id,
            "event_id": event.id,
            "start": "2024-06-01T09:00:00+00:00",
            "duration_seconds": 7200.0,
        })
        body = resp.json()
        start = datetime.fromisoformat(body["start"])
        end = datetime.fromisoformat(body["end"])
        assert end - start == timedelta(seconds=7200)

    def test_returns_409_on_duplicate_team_event(self, client, db):
        comp = make_competition(db)
        event = comp.events[0]
        team = make_team(db)
        make_participant(db, team.id, event.id)

        resp = client.post("/api/event-participants/", json={
            "team_id": team.id,
            "event_id": event.id,
        })
        assert resp.status_code == 409

    def test_rejects_negative_duration(self, client, db):
        comp = make_competition(db)
        event = comp.events[0]
        team = make_team(db)

        resp = client.post("/api/event-participants/", json={
            "team_id": team.id,
            "event_id": event.id,
            "duration_seconds": -1.0,
        })
        assert resp.status_code == 422


class TestListEventParticipants:
    def test_returns_empty_list_when_none_exist(self, client):
        resp = client.get("/api/event-participants/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_all_participants(self, client, db):
        comp = make_competition(db, event_types=[CompetitionEventType.DRAG_RACE, CompetitionEventType.GYMKHANA])
        team = make_team(db)
        make_participant(db, team.id, comp.events[0].id)
        make_participant(db, team.id, comp.events[1].id)

        resp = client.get("/api/event-participants/")
        assert len(resp.json()) == 2

    def test_filters_by_event_id(self, client, db):
        comp = make_competition(db, event_types=[CompetitionEventType.DRAG_RACE, CompetitionEventType.GYMKHANA])
        team = make_team(db)
        make_participant(db, team.id, comp.events[0].id)
        make_participant(db, team.id, comp.events[1].id)

        resp = client.get(f"/api/event-participants/?event_id={comp.events[0].id}")
        assert len(resp.json()) == 1
        assert resp.json()[0]["event_id"] == comp.events[0].id

    def test_filters_by_team_id(self, client, db):
        comp = make_competition(db)
        team_a = make_team(db, name="Team A")
        team_b = make_team(db, name="Team B")
        make_participant(db, team_a.id, comp.events[0].id)
        make_participant(db, team_b.id, comp.events[0].id)

        resp = client.get(f"/api/event-participants/?team_id={team_a.id}")
        assert len(resp.json()) == 1
        assert resp.json()[0]["team_id"] == team_a.id


class TestGetEventParticipant:
    def test_returns_participant_by_id(self, client, db):
        comp = make_competition(db)
        team = make_team(db)
        p = make_participant(db, team.id, comp.events[0].id)

        resp = client.get(f"/api/event-participants/{p.id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == p.id

    def test_returns_404_when_not_found(self, client):
        resp = client.get("/api/event-participants/9999")
        assert resp.status_code == 404


class TestUpdateEventParticipant:
    def test_sets_start_and_duration(self, client, db):
        comp = make_competition(db)
        team = make_team(db)
        p = make_participant(db, team.id, comp.events[0].id)

        resp = client.patch(f"/api/event-participants/{p.id}", json={
            "start": "2024-06-01T09:00:00+00:00",
            "duration_seconds": 1800.0,
        })
        assert resp.status_code == 200
        body = resp.json()
        assert body["duration_seconds"] == pytest.approx(1800.0)
        assert body["start"] is not None
        assert body["end"] is not None

    def test_partial_update_preserves_other_fields(self, client, db):
        comp = make_competition(db)
        team = make_team(db)
        p = make_participant(
            db, team.id, comp.events[0].id,
            start=datetime(2024, 6, 1, 9, 0, tzinfo=timezone.utc),
            duration_seconds=3600.0,
        )

        resp = client.patch(f"/api/event-participants/{p.id}", json={"duration_seconds": 7200.0})
        assert resp.status_code == 200
        assert resp.json()["duration_seconds"] == pytest.approx(7200.0)
        assert resp.json()["start"] is not None

    def test_can_clear_start_back_to_null(self, client, db):
        comp = make_competition(db)
        team = make_team(db)
        p = make_participant(
            db, team.id, comp.events[0].id,
            start=datetime(2024, 6, 1, 9, 0, tzinfo=timezone.utc),
            duration_seconds=3600.0,
        )

        resp = client.patch(f"/api/event-participants/{p.id}", json={"start": None})
        assert resp.status_code == 200
        assert resp.json()["start"] is None
        assert resp.json()["duration_seconds"] == 3600.0

    def test_omitting_field_does_not_clear_it(self, client, db):
        comp = make_competition(db)
        team = make_team(db)
        p = make_participant(
            db, team.id, comp.events[0].id,
            start=datetime(2024, 6, 1, 9, 0, tzinfo=timezone.utc),
            duration_seconds=3600.0,
        )

        resp = client.patch(f"/api/event-participants/{p.id}", json={"duration_seconds": 7200.0})
        assert resp.status_code == 200
        assert resp.json()["start"] is not None
        assert resp.json()["duration_seconds"] == pytest.approx(7200.0)

    def test_returns_404_when_not_found(self, client):
        resp = client.patch("/api/event-participants/9999", json={"duration_seconds": 100.0})
        assert resp.status_code == 404


class TestDeleteEventParticipant:
    def test_deletes_participant(self, client, db):
        comp = make_competition(db)
        team = make_team(db)
        p = make_participant(db, team.id, comp.events[0].id)

        resp = client.delete(f"/api/event-participants/{p.id}")
        assert resp.status_code == 204

        resp = client.get(f"/api/event-participants/{p.id}")
        assert resp.status_code == 404

    def test_returns_404_when_not_found(self, client):
        resp = client.delete("/api/event-participants/9999")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Auto-enroll on team creation
# ---------------------------------------------------------------------------

class TestAutoEnroll:
    def test_creates_participant_for_each_event_on_team_creation(self, client, db):
        comp = make_competition(db, event_types=[
            CompetitionEventType.DRAG_RACE,
            CompetitionEventType.GYMKHANA,
            CompetitionEventType.ENDURANCE_EFFICIENCY,
        ])

        resp = client.post("/api/teams/", json={
            "name": "Team Alpha",
            "vehicle_class": "Standard",
            "vehicle_type": "bike",
            "competition_id": comp.id,
        })
        assert resp.status_code == 201
        team_id = resp.json()["id"]

        participants = client.get(f"/api/event-participants/?team_id={team_id}").json()
        assert len(participants) == 3

    def test_auto_enrolled_participants_have_null_start_and_duration(self, client, db):
        comp = make_competition(db)

        resp = client.post("/api/teams/", json={
            "name": "Team Alpha",
            "vehicle_class": "Standard",
            "vehicle_type": "bike",
            "competition_id": comp.id,
        })
        team_id = resp.json()["id"]

        participants = client.get(f"/api/event-participants/?team_id={team_id}").json()
        for p in participants:
            assert p["start"] is None
            assert p["duration_seconds"] is None
            assert p["end"] is None

    def test_no_participants_created_when_no_competition(self, client):
        resp = client.post("/api/teams/", json={
            "name": "Team Alpha",
            "vehicle_class": "Standard",
            "vehicle_type": "bike",
        })
        team_id = resp.json()["id"]

        participants = client.get(f"/api/event-participants/?team_id={team_id}").json()
        assert participants == []


# ---------------------------------------------------------------------------
# Team-scoped frame queries
# ---------------------------------------------------------------------------

class TestTeamFrames:
    def test_returns_404_for_missing_team(self, client):
        resp = client.get("/api/teams/9999/frames")
        assert resp.status_code == 404

    def test_returns_empty_list_when_no_frames(self, client, db):
        team = make_team(db)
        resp = client.get(f"/api/teams/{team.id}/frames")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_all_frames_for_team(self, client, db):
        team = make_team(db)
        ecu = make_ecu(db, team_id=team.id)
        make_frame(db, ecu.id, team_id=team.id, timestamp_str="2024-01-01T10:00:00+00:00")
        make_frame(db, ecu.id, team_id=team.id, timestamp_str="2024-01-01T11:00:00+00:00")

        resp = client.get(f"/api/teams/{team.id}/frames")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_does_not_return_frames_from_other_teams(self, client, db):
        team_a = make_team(db, name="Team A")
        team_b = make_team(db, name="Team B")
        ecu_a = make_ecu(db, mac="AA:BB:CC:DD:EE:01", team_id=team_a.id)
        ecu_b = make_ecu(db, mac="AA:BB:CC:DD:EE:02", team_id=team_b.id)
        make_frame(db, ecu_a.id, team_id=team_a.id)
        make_frame(db, ecu_b.id, team_id=team_b.id)

        resp = client.get(f"/api/teams/{team_a.id}/frames")
        assert len(resp.json()) == 1

    def test_filters_frames_to_event_time_window(self, client, db):
        comp = make_competition(db)
        team = make_team(db)
        ecu = make_ecu(db, team_id=team.id)

        event = comp.events[0]
        start = datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc)
        make_participant(db, team.id, event.id, start=start, duration_seconds=3600.0)

        # inside window
        make_frame(db, ecu.id, team_id=team.id, timestamp_str="2024-01-01T10:30:00+00:00")
        # outside window
        make_frame(db, ecu.id, team_id=team.id, timestamp_str="2024-01-01T09:00:00+00:00")
        make_frame(db, ecu.id, team_id=team.id, timestamp_str="2024-01-01T12:00:00+00:00")

        resp = client.get(f"/api/teams/{team.id}/frames?event_id={event.id}")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_returns_404_when_team_not_enrolled_in_event(self, client, db):
        comp = make_competition(db)
        team = make_team(db)
        event = comp.events[0]
        # no participant record created

        resp = client.get(f"/api/teams/{team.id}/frames?event_id={event.id}")
        assert resp.status_code == 404

    def test_returns_all_frames_when_enrolled_but_no_start_set(self, client, db):
        comp = make_competition(db)
        team = make_team(db)
        ecu = make_ecu(db, team_id=team.id)

        event = comp.events[0]
        make_participant(db, team.id, event.id)  # no start/duration

        make_frame(db, ecu.id, team_id=team.id, timestamp_str="2024-01-01T10:00:00+00:00")
        make_frame(db, ecu.id, team_id=team.id, timestamp_str="2024-01-01T11:00:00+00:00")

        resp = client.get(f"/api/teams/{team.id}/frames?event_id={event.id}")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_filters_from_start_when_live(self, client, db):
        comp = make_competition(db)
        team = make_team(db)
        ecu = make_ecu(db, team_id=team.id)

        event = comp.events[0]
        start = datetime(2024, 1, 1, 10, 0, tzinfo=timezone.utc)
        make_participant(db, team.id, event.id, start=start)  # no duration — live

        make_frame(db, ecu.id, team_id=team.id, timestamp_str="2024-01-01T10:30:00+00:00")  # after start
        make_frame(db, ecu.id, team_id=team.id, timestamp_str="2024-01-01T09:00:00+00:00")  # before start

        resp = client.get(f"/api/teams/{team.id}/frames?event_id={event.id}")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_frames_from_multiple_ecus_returned_for_same_team(self, client, db):
        team = make_team(db)
        ecu1 = make_ecu(db, mac="AA:BB:CC:DD:EE:01", team_id=team.id)
        ecu2 = make_ecu(db, mac="AA:BB:CC:DD:EE:02", team_id=team.id)
        make_frame(db, ecu1.id, team_id=team.id, timestamp_str="2024-01-01T10:00:00+00:00")
        make_frame(db, ecu2.id, team_id=team.id, timestamp_str="2024-01-01T11:00:00+00:00")

        resp = client.get(f"/api/teams/{team.id}/frames")
        assert len(resp.json()) == 2


# ---------------------------------------------------------------------------
# team_id stamped on frames at ingest
# ---------------------------------------------------------------------------

class TestSaveFrameTeamId:
    def test_frame_gets_team_id_from_ecu(self, db):
        from app.services.storage import save_frame

        team = make_team(db)
        ecu = make_ecu(db, team_id=team.id)

        frame, created = save_frame(db, {
            "mac_address": ecu.mac_address,
            "timestamp": datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc),
            "avg_voltage": 40.0,
            "avg_current": 2.0,
        })

        assert created is True
        assert frame.team_id == team.id

    def test_frame_has_null_team_id_when_ecu_unassigned(self, db):
        from app.services.storage import save_frame

        ecu = make_ecu(db, team_id=None)

        frame, created = save_frame(db, {
            "mac_address": ecu.mac_address,
            "timestamp": datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc),
            "avg_voltage": 40.0,
            "avg_current": 2.0,
        })

        assert created is True
        assert frame.team_id is None
