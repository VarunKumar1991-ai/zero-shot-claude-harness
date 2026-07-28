"""Auto-profiling of an ingested pandas DataFrame.

Builds the `DatasetProfile` domain model returned by `POST /datasets/upload`
and `GET /datasets/{id}` (see spec/api.md): per-column stats, the overall row
count, the detected date range, and a list of `quality_issues` — messy data is
always surfaced here, never silently dropped (see spec/roadmap.md → Key
Constraints).
"""
import re

import pandas as pd

from domain.dataset import ColumnProfile, DatasetProfile, DateRange, QualityIssue

_MAX_SAMPLE_VALUES = 5
_MAX_EXAMPLES = 5
_NUMERIC_RE = re.compile(r"^\s*-?\d+(\.\d+)?\s*$")


def _dtype_label(series: pd.Series) -> str:
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date"
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if pd.api.types.is_integer_dtype(series) or pd.api.types.is_float_dtype(series):
        return "number"
    return "string"


def _format_number(value) -> str:
    as_float = float(value)
    if as_float.is_integer():
        return str(int(as_float))
    return str(as_float)


def build_column_profiles(df: pd.DataFrame) -> list[ColumnProfile]:
    """Per-column {name, dtype, null_count, distinct_count, sample_values/min/max}."""
    profiles: list[ColumnProfile] = []
    for column in df.columns:
        series = df[column]
        dtype = _dtype_label(series)
        null_count = int(series.isna().sum())
        distinct_count = int(series.dropna().nunique())
        non_null = series.dropna()

        sample_values: list[str] | None = None
        min_value: str | None = None
        max_value: str | None = None

        if dtype == "date":
            if not non_null.empty:
                min_value = pd.Timestamp(non_null.min()).date().isoformat()
                max_value = pd.Timestamp(non_null.max()).date().isoformat()
        elif dtype == "number":
            if not non_null.empty:
                min_value = _format_number(non_null.min())
                max_value = _format_number(non_null.max())
        else:
            sample_values = list(dict.fromkeys(non_null.astype(str).tolist()))[:_MAX_SAMPLE_VALUES]

        profiles.append(
            ColumnProfile(
                name=str(column),
                dtype=dtype,
                null_count=null_count,
                distinct_count=distinct_count,
                sample_values=sample_values,
                min=min_value,
                max=max_value,
            )
        )
    return profiles


def detect_missing_values(df: pd.DataFrame) -> list[QualityIssue]:
    """Any column with at least one null/missing cell."""
    issues: list[QualityIssue] = []
    for column in df.columns:
        null_count = int(df[column].isna().sum())
        if null_count > 0:
            issues.append(
                QualityIssue(
                    issue_type="missing_value",
                    column=str(column),
                    affected_row_count=null_count,
                    examples=[],
                )
            )
    return issues


def detect_type_mismatches(df: pd.DataFrame) -> list[QualityIssue]:
    """A column that looks numeric but has some non-numeric string junk mixed in."""
    issues: list[QualityIssue] = []
    for column in df.columns:
        series = df[column]
        if (
            pd.api.types.is_numeric_dtype(series)
            or pd.api.types.is_datetime64_any_dtype(series)
            or pd.api.types.is_bool_dtype(series)
        ):
            continue
        non_null = series.dropna().astype(str)
        if non_null.empty:
            continue
        numeric_like = non_null.str.match(_NUMERIC_RE)
        numeric_ratio = numeric_like.mean()
        if 0.5 <= numeric_ratio < 1.0:
            bad_values = non_null[~numeric_like].unique().tolist()[:_MAX_EXAMPLES]
            affected = int((~numeric_like).sum())
            issues.append(
                QualityIssue(
                    issue_type="type_mismatch",
                    column=str(column),
                    affected_row_count=affected,
                    examples=bad_values,
                )
            )
    return issues


def _compute_date_range(column_profiles: list[ColumnProfile]) -> DateRange | None:
    for profile in column_profiles:
        if profile.dtype == "date" and profile.min and profile.max:
            return DateRange(start=profile.min, end=profile.max)
    return None


def profile_dataframe(
    df: pd.DataFrame, extra_quality_issues: list[QualityIssue] | None = None
) -> DatasetProfile:
    """Build the full profile for one ingested dataset.

    `extra_quality_issues` carries CSV-parsing-time issues detected upstream
    (e.g. `unparseable_date`, computed in `csv_ingest.py` before bad date
    strings are coerced to null) so they aren't reported twice as generic
    missing values for the same column.
    """
    extra_quality_issues = extra_quality_issues or []
    excluded_columns = {issue.column for issue in extra_quality_issues}

    column_profiles = build_column_profiles(df)

    quality_issues = list(extra_quality_issues)
    quality_issues += [
        issue for issue in detect_missing_values(df) if issue.column not in excluded_columns
    ]
    quality_issues += detect_type_mismatches(df)

    return DatasetProfile(
        row_count=len(df),
        columns=column_profiles,
        date_range=_compute_date_range(column_profiles),
        quality_issues=quality_issues,
    )
