"""The single abstraction the agent graph and sandbox use to read data.

See spec/architecture.md -> "Keeping the Data-Source Layer Swappable for a
Future MySQL Source". `LocalParquetDataSource` (Phase 1-3) is the only
implementation; a future `MySQLDataSource` would implement the same four
methods against a read replica without any change to callers.

`DatasetProfile` here is the **domain** Pydantic model (`domain.dataset.DatasetProfile`)
-- never the SQLAlchemy `db.models.DatasetProfile` row.
"""
from typing import Protocol

import pandas as pd

from domain.dataset import DatasetProfile


class DataSource(Protocol):
    def profile(self, dataset_ref: str) -> DatasetProfile: ...

    def get_dataframe(self, dataset_ref: str, columns: list[str] | None = None) -> pd.DataFrame: ...

    def distinct_values(self, dataset_ref: str, column: str, limit: int = 20) -> list[str]: ...

    def row_count(self, dataset_ref: str) -> int: ...
