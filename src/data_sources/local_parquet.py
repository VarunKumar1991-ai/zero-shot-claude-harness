"""`DataSource` implementation backed by local Parquet files, queried via DuckDB.

Phase 1-3 backend for `AGENT_DATA_SOURCE=local_parquet` (the only implemented
option). `dataset_ref` is the dataset's `storage_path` (a Parquet file path).
"""
from pathlib import Path

import duckdb
import pandas as pd

from domain.dataset import DatasetProfile
from ingestion.profiling import profile_dataframe


def _quoted_path(dataset_ref: str) -> str:
    # DuckDB's read_parquet() takes a POSIX-style path literal; escape any
    # embedded single quotes defensively even though paths shouldn't contain them.
    posix = Path(dataset_ref).as_posix()
    return posix.replace("'", "''")


def _quoted_ident(name: str) -> str:
    return name.replace('"', '""')


class LocalParquetDataSource:
    def get_dataframe(self, dataset_ref: str, columns: list[str] | None = None) -> pd.DataFrame:
        df = duckdb.sql(f"SELECT * FROM read_parquet('{_quoted_path(dataset_ref)}')").df()
        if columns:
            df = df[columns]
        return df

    def profile(self, dataset_ref: str) -> DatasetProfile:
        return profile_dataframe(self.get_dataframe(dataset_ref))

    def distinct_values(self, dataset_ref: str, column: str, limit: int = 20) -> list[str]:
        query = (
            f'SELECT DISTINCT "{_quoted_ident(column)}" AS value '
            f"FROM read_parquet('{_quoted_path(dataset_ref)}') LIMIT {int(limit)}"
        )
        result = duckdb.sql(query).df()
        return [str(v) for v in result["value"].dropna().tolist()]

    def row_count(self, dataset_ref: str) -> int:
        query = f"SELECT COUNT(*) AS n FROM read_parquet('{_quoted_path(dataset_ref)}')"
        result = duckdb.sql(query).df()
        return int(result["n"].iloc[0])
