from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import settings


DATABASE_URL = settings.DATABASE_URL

def _engine_connect_args(url: str) -> dict[str, object]:
	# SQLite requires this in multi-threaded web apps like FastAPI.
	if url.startswith("sqlite"):
		return {"check_same_thread": False}
	return {}

# Create the SQLAlchemy engine and session factory. 
# The engine is the core interface to the database, 
# and the session factory creates sessions for interacting 
# with the database in a thread-safe way. 
engine = create_engine(
	DATABASE_URL,
	pool_pre_ping=True,
	connect_args=_engine_connect_args(DATABASE_URL),
)

# We disable autocommit and autoflush for better control over transactions 
# and performance, especially in a web app context where we want to manage 
# sessions explicitly.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine) 
Base = declarative_base() # Base class for our ORM models, they will inherit from this to get SQLAlchemy functionality

# Dependency function to get a database session for each request. This is used in FastAPI endpoints 
# to ensure that each request gets its own session, which is properly closed after the request is done.
def get_db() -> Generator[Session, None, None]:
	"""Yield a request-scoped SQLAlchemy session."""
	db = SessionLocal()
	try:
		yield db
	finally:
		db.close()

# Function to initialize the database by creating all tables. This should be called at 
# application startup to ensure the database schema is in place.
def init_db() -> None:
	"""Create all known tables.

	Importing models here ensures SQLAlchemy registers metadata before create_all.
	"""
	from app.models import (  # noqa: F401
		Alert,
		Competition,
		CompetitionEvent,
		ECU,
		EnergyFrame,
		PowerViolationEvent,
		Team,
	)

	Base.metadata.create_all(bind=engine)
	_ensure_energy_frame_power_column()
	_ensure_ecu_team_id_column()
	_ensure_teams_competition_id_column()


def _ensure_energy_frame_power_column() -> None:
	"""Ensure legacy databases have the EnergyFrame power_watts column. Can be removed in the future once all databases have been migrated."""
	inspector = inspect(engine)
	if "energy_frames" not in inspector.get_table_names():
		return

	column_names = {column["name"] for column in inspector.get_columns("energy_frames")}
	if "power_watts" in column_names:
		return

	with engine.begin() as conn:
		conn.execute(text("ALTER TABLE energy_frames ADD COLUMN power_watts FLOAT"))
		conn.execute(text("UPDATE energy_frames SET power_watts = avg_voltage * avg_current WHERE power_watts IS NULL"))


def _ensure_ecu_team_id_column() -> None:
	"""Ensure legacy databases have the ECU team_id column used by team assignment APIs."""
	inspector = inspect(engine)
	if "ecus" not in inspector.get_table_names():
		return

	column_names = {column["name"] for column in inspector.get_columns("ecus")}
	if "team_id" in column_names:
		return

	with engine.begin() as conn:
		conn.execute(text("ALTER TABLE ecus ADD COLUMN team_id INTEGER"))
		conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ecus_team_id ON ecus(team_id)"))


def _ensure_teams_competition_id_column() -> None:
	"""Ensure legacy databases have the teams competition_id column."""
	inspector = inspect(engine)
	if "teams" not in inspector.get_table_names():
		return

	column_names = {column["name"] for column in inspector.get_columns("teams")}
	if "competition_id" in column_names:
		return

	with engine.begin() as conn:
		conn.execute(text("ALTER TABLE teams ADD COLUMN competition_id INTEGER REFERENCES competitions(id) ON DELETE SET NULL"))
		conn.execute(text("CREATE INDEX IF NOT EXISTS ix_teams_competition_id ON teams(competition_id)"))
