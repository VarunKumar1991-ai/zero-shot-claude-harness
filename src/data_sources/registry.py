"""Resolves the configured `DataSource` from `AGENT_DATA_SOURCE` (default
`local_parquet`). Only `local_parquet` is implemented in Phase 1-3; a future
`MySQLDataSource` would be added here without any caller change (see
spec/architecture.md)."""
from config.settings import get_settings
from data_sources.base import DataSource
from data_sources.local_parquet import LocalParquetDataSource


def get_data_source() -> DataSource:
    settings = get_settings()
    if settings.data_source == "local_parquet":
        return LocalParquetDataSource()
    raise ValueError(
        f"Unsupported AGENT_DATA_SOURCE={settings.data_source!r}; "
        "only 'local_parquet' is implemented in Phase 1"
    )
