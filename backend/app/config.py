from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_URL = f"sqlite:///{(BACKEND_DIR / 'ecu_data.db').as_posix()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    HOST: str = "0.0.0.0" # Listen on all interfaces by default
    PORT: int = 8000
    DATABASE_URL: str = DEFAULT_DATABASE_URL
    TLS_CERT_PATH: str | None = None # 
    TLS_KEY_PATH: str | None = None # TLS is optional and can be configured in production for secure communication
    ALLOWED_ORIGINS: str = Field(default="http://localhost:5173")
    SERIAL_PORT: str | None = None
    SERIAL_BAUD: int = 115200


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()