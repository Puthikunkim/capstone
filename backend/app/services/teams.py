from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.competition import CompetitionEvent
from app.models.ecu import ECU
from app.models.event_participant import EventParticipant
from app.models.team import Team
from app.schemas.team import TeamCreate


class TeamNameConflictError(ValueError):
    pass


class ECUAssignmentConflictError(ValueError):
    pass


class TeamAlreadyInCompetitionError(ValueError):
    pass


def create_team(db: Session, payload: TeamCreate) -> Team:
    normalized_name = payload.name.strip()

    existing = db.scalar(select(Team).where(Team.name == normalized_name))
    if existing is not None:
        raise TeamNameConflictError(f"A team named '{normalized_name}' already exists")

    team = Team(
        name=normalized_name,
        competition_id=payload.competition_id,
        vehicle_class=payload.vehicle_class,
        vehicle_type=payload.vehicle_type,
    )
    db.add(team)
    db.flush()

    if payload.competition_id is not None:
        _enroll_team_in_competition_events(db, team, payload.competition_id)

    db.commit()
    db.refresh(team)
    return team


def _enroll_team_in_competition_events(db: Session, team: Team, competition_id: int) -> None:
    events = db.scalars(
        select(CompetitionEvent).where(CompetitionEvent.competition_id == competition_id)
    ).all()
    try:
        with db.begin_nested():
            for event in events:
                db.add(EventParticipant(team_id=team.id, event_id=event.id))
    except IntegrityError:
        pass  # already enrolled — outer transaction (and team) stays intact


def add_team_to_competition(db: Session, team: Team, competition_id: int) -> Team:
    if team.competition_id == competition_id:
        raise TeamAlreadyInCompetitionError(f"Team '{team.name}' is already in this competition")
    team.competition_id = competition_id
    db.flush()
    _enroll_team_in_competition_events(db, team, competition_id)
    db.commit()
    db.refresh(team)
    return team


def list_teams(db: Session) -> list[Team]:
    stmt = select(Team).order_by(Team.name.asc(), Team.id.asc())
    return list(db.scalars(stmt).all())


def get_team(db: Session, team_id: int) -> Team | None:
    return db.get(Team, team_id)


def list_team_ecus(db: Session, team_id: int) -> list[ECU]:
    stmt = (
        select(ECU)
        .where(ECU.team_id == team_id)
        .order_by(ECU.last_seen.desc().nullslast(), ECU.mac_address.asc().nullslast())
    )
    return list(db.scalars(stmt).all())


def list_teams_by_competition(db: Session, competition_id: int) -> list[Team]:
    stmt = select(Team).where(Team.competition_id == competition_id).order_by(Team.name.asc(), Team.id.asc())
    return list(db.scalars(stmt).all())


def list_unassigned_ecus(db: Session) -> list[ECU]:
    stmt = (
        select(ECU)
        .where(ECU.team_id.is_(None))
        .order_by(ECU.last_seen.desc().nullslast(), ECU.mac_address.asc().nullslast())
    )
    return list(db.scalars(stmt).all())


def assign_team_to_ecu(db: Session, team: Team, ecu: ECU) -> ECU:
    if ecu.team_id is not None and ecu.team_id != team.id:
        raise ECUAssignmentConflictError(
            f"ECU {ecu.id} is already assigned to team {ecu.team_id}"
        )

    ecu.team_id = team.id
    ecu.team_number = team.id
    ecu.vehicle_class = team.vehicle_class
    ecu.vehicle_type = team.vehicle_type

    db.commit()
    db.refresh(ecu)
    return ecu


def unassign_team_from_ecu(db: Session, team: Team, ecu: ECU) -> ECU:
    if ecu.team_id is None:
        raise ECUAssignmentConflictError(f"ECU {ecu.id} is not assigned to any team")
    if ecu.team_id != team.id:
        raise ECUAssignmentConflictError(
            f"ECU {ecu.id} is assigned to team {ecu.team_id}, not team {team.id}"
        )

    ecu.team_id = None
    ecu.team_number = 0

    db.commit()
    db.refresh(ecu)
    return ecu
