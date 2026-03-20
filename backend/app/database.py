from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
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
	from app.models import Alert, ECU, EnergyFrame  # noqa: F401

	Base.metadata.create_all(bind=engine)
