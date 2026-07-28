import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from data_sources.local_parquet import LocalParquetDataSource


def _write_fixture(tmp_path) -> str:
    df = pd.DataFrame(
        {
            "offence_type": ["Theft", "Assault", "Theft", "Robbery"],
            "location": ["Lucknow", "Kanpur", "Lucknow", "Agra"],
        }
    )
    path = tmp_path / "fixture.parquet"
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), path)
    return str(path)


def test_row_count(tmp_path):
    path = _write_fixture(tmp_path)
    source = LocalParquetDataSource()
    assert source.row_count(path) == 4


def test_get_dataframe_returns_all_columns_and_rows(tmp_path):
    path = _write_fixture(tmp_path)
    source = LocalParquetDataSource()
    df = source.get_dataframe(path)
    assert list(df.columns) == ["offence_type", "location"]
    assert len(df) == 4


def test_get_dataframe_with_column_selection(tmp_path):
    path = _write_fixture(tmp_path)
    source = LocalParquetDataSource()
    df = source.get_dataframe(path, columns=["offence_type"])
    assert list(df.columns) == ["offence_type"]


def test_distinct_values(tmp_path):
    path = _write_fixture(tmp_path)
    source = LocalParquetDataSource()
    values = source.distinct_values(path, "offence_type", limit=10)
    assert set(values) == {"Theft", "Assault", "Robbery"}


def test_distinct_values_respects_limit(tmp_path):
    path = _write_fixture(tmp_path)
    source = LocalParquetDataSource()
    values = source.distinct_values(path, "location", limit=1)
    assert len(values) == 1


def test_profile_returns_domain_profile_with_expected_columns(tmp_path):
    path = _write_fixture(tmp_path)
    source = LocalParquetDataSource()
    profile = source.profile(path)

    assert profile.row_count == 4
    names = {c.name for c in profile.columns}
    assert names == {"offence_type", "location"}


def test_row_count_missing_file_raises(tmp_path):
    missing = tmp_path / "does_not_exist.parquet"
    source = LocalParquetDataSource()
    with pytest.raises(Exception):
        source.row_count(str(missing))
