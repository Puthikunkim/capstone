import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import AsyncMock, patch

import app.models  # noqa: F401 — registers all models with Base.metadata
from app.database import Base, get_db
from app.services.broadcast import manager

# StaticPool forces all connections to share the same underlying SQLite
# connection, so tables created by create_all are visible to every session.
TEST_DB_URL = "sqlite://"


@pytest.fixture()
def engine():
    e = create_engine(
        TEST_DB_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=e)
    yield e
    Base.metadata.drop_all(bind=e)
    e.dispose()


@pytest.fixture()
def db(engine):
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = Session()
    yield session
    session.close()


@pytest.fixture()
def client(db):
    from main import create_app

    fastapi_app = create_app()

    def override_get_db():
        yield db

    fastapi_app.dependency_overrides[get_db] = override_get_db

    with (
        patch.object(manager, "notify", new_callable=AsyncMock),
        patch.object(manager, "notify_violation_event", new_callable=AsyncMock),
        patch.object(manager, "notify_alert", new_callable=AsyncMock),
        patch("main.init_db"),
    ):
        with TestClient(fastapi_app) as c:
            yield c
