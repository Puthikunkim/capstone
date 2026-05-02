# Unit tests for competition management endpoints (routers/competitions.py).

from app.models.competition import Competition, CompetitionEvent, CompetitionEventType
from app.models.ecu import VehicleClass, VehicleType
from app.models.team import Team


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


class TestCreateCompetition:
    def test_creates_competition_with_selected_events(self, client):
        resp = client.post("/api/competitions/", json={
            "name": "Round 1",
            "event_types": ["drag_race", "gymkhana"],
        })
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Round 1"
        event_types = [e["event_type"] for e in body["events"]]
        assert set(event_types) == {"drag_race", "gymkhana"}

    def test_creates_all_three_events_by_default(self, client):
        resp = client.post("/api/competitions/", json={"name": "Round 1"})
        assert resp.status_code == 201
        assert len(resp.json()["events"]) == 3

    def test_returns_409_on_duplicate_name(self, client, db):
        make_competition(db, name="Round 1")
        resp = client.post("/api/competitions/", json={"name": "Round 1"})
        assert resp.status_code == 409

    def test_rejects_blank_name(self, client):
        resp = client.post("/api/competitions/", json={"name": "   "})
        assert resp.status_code == 422

    def test_strips_whitespace_from_name(self, client):
        resp = client.post("/api/competitions/", json={
            "name": "  Round 1  ",
            "event_types": ["drag_race"],
        })
        assert resp.status_code == 201
        assert resp.json()["name"] == "Round 1"


class TestListCompetitions:
    def test_returns_empty_list_when_no_competitions(self, client):
        resp = client.get("/api/competitions/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_all_competitions(self, client, db):
        make_competition(db, name="Round 1")
        make_competition(db, name="Round 2")
        resp = client.get("/api/competitions/")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_response_includes_events(self, client, db):
        make_competition(db, name="Round 1", event_types=[
            CompetitionEventType.DRAG_RACE,
            CompetitionEventType.GYMKHANA,
        ])
        resp = client.get("/api/competitions/")
        assert resp.status_code == 200
        events = resp.json()[0]["events"]
        assert len(events) == 2

    def test_returns_competitions_in_alphabetical_order(self, client, db):
        make_competition(db, name="Zebra Cup")
        make_competition(db, name="Alpha Cup")
        names = [c["name"] for c in client.get("/api/competitions/").json()]
        assert names == sorted(names)


class TestGetCompetition:
    def test_returns_competition_by_id(self, client, db):
        comp = make_competition(db, name="Round 1")
        resp = client.get(f"/api/competitions/{comp.id}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Round 1"

    def test_returns_404_when_not_found(self, client):
        resp = client.get("/api/competitions/9999")
        assert resp.status_code == 404

    def test_includes_events_in_detail(self, client, db):
        comp = make_competition(db, event_types=[CompetitionEventType.ENDURANCE_EFFICIENCY])
        resp = client.get(f"/api/competitions/{comp.id}")
        assert resp.status_code == 200
        event_types = [e["event_type"] for e in resp.json()["events"]]
        assert "endurance_efficiency" in event_types


class TestListCompetitionTeams:
    def test_returns_404_when_competition_not_found(self, client):
        resp = client.get("/api/competitions/9999/teams")
        assert resp.status_code == 404

    def test_returns_empty_list_when_no_teams(self, client, db):
        comp = make_competition(db)
        resp = client.get(f"/api/competitions/{comp.id}/teams")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_teams_belonging_to_competition(self, client, db):
        comp = make_competition(db)
        make_team(db, name="Team A", competition_id=comp.id)
        make_team(db, name="Team B", competition_id=comp.id)
        resp = client.get(f"/api/competitions/{comp.id}/teams")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_excludes_teams_from_other_competitions(self, client, db):
        comp_a = make_competition(db, name="Comp A")
        comp_b = make_competition(db, name="Comp B")
        make_team(db, name="Team A", competition_id=comp_a.id)
        make_team(db, name="Team B", competition_id=comp_b.id)

        resp = client.get(f"/api/competitions/{comp_a.id}/teams")
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["name"] == "Team A"

    def test_excludes_teams_with_no_competition(self, client, db):
        comp = make_competition(db)
        make_team(db, name="Unassigned Team", competition_id=None)
        resp = client.get(f"/api/competitions/{comp.id}/teams")
        assert resp.status_code == 200
        assert resp.json() == []
