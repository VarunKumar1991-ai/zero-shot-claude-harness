"""CSV validation and CSV -> Parquet conversion.

Rejects empty files, unparseable files, and files over `AGENT_MAX_CSV_MB`.
Auto-detects date-like columns and converts them, tracking any values that
failed to parse as `unparseable_date` quality issues (surfaced, never
silently dropped) so `ingestion/profiling.py` can report them.
"""
import io
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from config.settings import get_settings
from domain.dataset import QualityIssue

_MAX_DATE_EXAMPLES = 5
_DATE_HINTS = ("date", "_at", "time", "dob")


class CsvIngestError(Exception):
    """Raised for any user-facing 400 (empty, oversized, or unparseable file)."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


@dataclass
class IngestResult:
    dataset_id: str
    dataframe: pd.DataFrame
    storage_path: str
    size_bytes: int
    date_quality_issues: list[QualityIssue] = field(default_factory=list)


def _looks_date_like(column_name: str) -> bool:
    lowered = str(column_name).lower()
    return any(hint in lowered for hint in _DATE_HINTS)


def _convert_date_columns(df: pd.DataFrame) -> tuple[pd.DataFrame, list[QualityIssue]]:
    issues: list[QualityIssue] = []
    for column in df.columns:
        already_numeric_or_datetime = pd.api.types.is_numeric_dtype(
            df[column]
        ) or pd.api.types.is_datetime64_any_dtype(df[column])
        if already_numeric_or_datetime or not _looks_date_like(column):
            continue

        original = df[column]
        non_null_mask = original.notna()
        non_null_count = int(non_null_mask.sum())
        if non_null_count == 0:
            continue

        converted = pd.to_datetime(original, errors="coerce", format="mixed")
        parsed_ratio = converted.notna().sum() / non_null_count
        if parsed_ratio < 0.5:
            continue  # doesn't look like a date column after all — leave as string

        failed_mask = non_null_mask & converted.isna()
        failed_count = int(failed_mask.sum())
        if failed_count > 0:
            examples = original[failed_mask].astype(str).unique().tolist()[:_MAX_DATE_EXAMPLES]
            issues.append(
                QualityIssue(
                    issue_type="unparseable_date",
                    column=str(column),
                    affected_row_count=failed_count,
                    examples=examples,
                )
            )
        df[column] = converted
    return df, issues


def ingest_csv(file_bytes: bytes, dataset_id: str | None = None) -> IngestResult:
    settings = get_settings()
    size_bytes = len(file_bytes)

    if size_bytes == 0:
        raise CsvIngestError("Uploaded file is empty")

    max_bytes = settings.max_csv_mb * 1024 * 1024
    if size_bytes > max_bytes:
        raise CsvIngestError(f"File exceeds the {settings.max_csv_mb}MB upload limit")

    try:
        df = pd.read_csv(io.BytesIO(file_bytes))
    except Exception as exc:
        raise CsvIngestError(f"Could not parse file as CSV: {exc}") from exc

    if df.shape[1] == 0:
        raise CsvIngestError("No columns detected in the uploaded file")

    df, date_quality_issues = _convert_date_columns(df)

    dataset_id = dataset_id or str(uuid4())
    store_dir = Path(settings.dataset_store_dir)
    store_dir.mkdir(parents=True, exist_ok=True)
    storage_path = store_dir / f"{dataset_id}.parquet"

    # Disk write failures are NOT a CsvIngestError (400) — they are a 500 at the
    # API layer (spec/api.md), so a bad-CSV vs. an ingestion/infra failure are
    # distinguishable to the caller.
    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, storage_path)

    return IngestResult(
        dataset_id=dataset_id,
        dataframe=df,
        storage_path=str(storage_path),
        size_bytes=size_bytes,
        date_quality_issues=date_quality_issues,
    )
