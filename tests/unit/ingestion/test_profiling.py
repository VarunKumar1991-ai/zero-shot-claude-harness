import pandas as pd

from domain.dataset import QualityIssue
from ingestion.profiling import (
    build_column_profiles,
    detect_missing_values,
    detect_type_mismatches,
    profile_dataframe,
)


def _sample_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "case_number": ["FIR001", "FIR002", None, "FIR004", "FIR005"],
            "offence_type": ["Theft", "Assault", "Theft", "Robbery", "Theft"],
            "date_reported": pd.to_datetime(
                ["2024-01-05", "2024-02-10", None, "2024-04-20", "2024-05-01"]
            ),
            "victim_age": ["25", "30", "unknown", "40", "22"],
        }
    )


def test_build_column_profiles_reports_dtype_and_stats():
    df = _sample_df()
    profiles = {p.name: p for p in build_column_profiles(df)}

    assert profiles["offence_type"].dtype == "string"
    assert profiles["offence_type"].distinct_count == 3
    assert set(profiles["offence_type"].sample_values or []) <= {"Theft", "Assault", "Robbery"}

    assert profiles["date_reported"].dtype == "date"
    assert profiles["date_reported"].null_count == 1
    assert profiles["date_reported"].min == "2024-01-05"
    assert profiles["date_reported"].max == "2024-05-01"

    assert profiles["case_number"].null_count == 1
    assert profiles["case_number"].distinct_count == 4


def test_detect_missing_values_flags_null_column_not_dropped():
    df = _sample_df()
    issues = detect_missing_values(df)
    by_column = {i.column: i for i in issues}

    assert "case_number" in by_column
    assert by_column["case_number"].affected_row_count == 1
    assert by_column["case_number"].issue_type == "missing_value"
    # date_reported also has one null cell — it must be flagged too when not excluded
    assert "date_reported" in by_column


def test_detect_type_mismatches_flags_string_junk_in_mostly_numeric_column():
    df = _sample_df()
    issues = detect_type_mismatches(df)
    by_column = {i.column: i for i in issues}

    assert "victim_age" in by_column
    assert by_column["victim_age"].affected_row_count == 1
    assert "unknown" in by_column["victim_age"].examples
    # a genuinely categorical column must never be flagged as a numeric mismatch
    assert "offence_type" not in by_column


def test_profile_dataframe_merges_extra_issues_and_computes_date_range():
    df = _sample_df()
    extra = [
        QualityIssue(
            issue_type="unparseable_date",
            column="date_reported",
            affected_row_count=1,
            examples=["32/13/2024"],
        )
    ]
    profile = profile_dataframe(df, extra_quality_issues=extra)

    assert profile.row_count == 5
    assert profile.date_range is not None
    assert profile.date_range.start == "2024-01-05"
    assert profile.date_range.end == "2024-05-01"

    issue_types = {i.issue_type for i in profile.quality_issues}
    assert "unparseable_date" in issue_types
    assert "missing_value" in issue_types
    assert "type_mismatch" in issue_types

    # date_reported's null cell is already explained by unparseable_date —
    # it must not ALSO be double-reported as a generic missing_value.
    date_column_issue_types = {
        i.issue_type for i in profile.quality_issues if i.column == "date_reported"
    }
    assert date_column_issue_types == {"unparseable_date"}


def test_profile_dataframe_empty_dataframe_has_zero_row_count_and_no_crash():
    df = pd.DataFrame({"case_number": [], "offence_type": []})
    profile = profile_dataframe(df)

    assert profile.row_count == 0
    assert profile.date_range is None
    assert profile.quality_issues == []
