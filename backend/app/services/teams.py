from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ecu import ECU
from app.models.team import Team
from app.schemas.team import TeamCreate


class TeamNameConflictError(ValueError):
    pass


class ECUAssignmentConflictError(ValueError):
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
        .order_by(ECU.last_seen.desc().nullslast(), ECU.serial_number.asc())
    )
    return list(db.scalars(stmt).all())


def list_teams_by_competition(db: Session, competition_id: int) -> list[Team]:
    stmt = select(Team).where(Team.competition_id == competition_id).order_by(Team.name.asc(), Team.id.asc())
    return list(db.scalars(stmt).all())


def list_unassigned_ecus(db: Session) -> list[ECU]:
    stmt = (
        select(ECU)
        .where(ECU.team_id.is_(None))
        .order_by(ECU.last_seen.desc().nullslast(), ECU.serial_number.asc())
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
