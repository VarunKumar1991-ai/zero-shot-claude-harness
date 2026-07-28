from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AGENT_",
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = Field(default="sqlite:///./data/agent.db")
    log_level: str = Field(default="INFO")

    # LLM provider — auto-detected from whichever key is set if left blank
    llm_provider: str = Field(default="")   # "anthropic" | "gemini"
    llm_model: str = Field(default="")      # uses provider default when blank

    # Provider keys — set exactly one
    anthropic_api_key: str = Field(default="")
    gemini_api_key: str = Field(default="")

    # UP Police Data Analyst Agent — Phase 1 operational knobs (see spec/architecture.md → Stack)
    upload_dir: str = Field(default="./data/uploads")
    dataset_store_dir: str = Field(default="./data/datasets")
    max_csv_mb: int = Field(default=100)
    sandbox_timeout_seconds: int = Field(default=20)
    max_code_retries: int = Field(default=3)
    conversation_history_turns: int = Field(default=5)
    session_ttl_hours: int = Field(default=12)
    llm_fast_model: str = Field(default="gemini-2.5-flash")
    data_source: str = Field(default="local_parquet")


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
