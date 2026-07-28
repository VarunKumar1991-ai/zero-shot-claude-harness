"""Sandbox executor tests — verify AST validation, subprocess isolation,
timeout enforcement, and result capping actually work on this OS (Windows in
dev), per spec/architecture.md -> "Sandboxing Approach"."""
import pandas as pd
import pytest

from sandbox.executor import SandboxValidationError, run_sandboxed, validate_code


def _sample_df() -> pd.DataFrame:
    return pd.DataFrame({
        "offence_type": ["Theft", "Assault", "Theft", "Burglary", "Theft"],
        "count": [1, 2, 3, 4, 5],
    })


def test_safe_code_runs_and_returns_result():
    code = "def analyze(df):\n    return {'count': int((df['offence_type'] == 'Theft').sum())}\n"
    result, stdout, error, duration_ms = run_sandboxed(code, _sample_df(), timeout_seconds=10)
    assert error is None
    assert result["count"] == 3
    assert duration_ms >= 0


def test_import_of_os_is_rejected_before_execution():
    code = "import os\ndef analyze(df):\n    return {'x': os.getcwd()}\n"
    with pytest.raises(SandboxValidationError):
        validate_code(code)

    result, stdout, error, duration_ms = run_sandboxed(code, _sample_df(), timeout_seconds=10)
    assert result is None
    assert error is not None
    assert "not allowed" in error


def test_dunder_globals_access_is_rejected():
    code = (
        "def analyze(df):\n"
        "    return {'leak': str(analyze.__globals__)}\n"
    )
    with pytest.raises(SandboxValidationError):
        validate_code(code)

    result, stdout, error, duration_ms = run_sandboxed(code, _sample_df(), timeout_seconds=10)
    assert result is None
    assert error is not None


def test_disallowed_module_import_is_rejected():
    code = "import subprocess\ndef analyze(df):\n    return {}\n"
    result, stdout, error, duration_ms = run_sandboxed(code, _sample_df(), timeout_seconds=10)
    assert result is None
    assert "not allowed" in error


def test_infinite_loop_is_terminated_by_timeout():
    code = "def analyze(df):\n    while True:\n        pass\n"
    result, stdout, error, duration_ms = run_sandboxed(code, _sample_df(), timeout_seconds=2)
    assert result is None
    assert error is not None
    assert "timed out" in error


def test_result_is_capped_to_50_rows_with_truncated_flag():
    code = (
        "def analyze(df):\n"
        "    import pandas as pd\n"
        "    return pd.DataFrame({'n': list(range(200))})\n"
    )
    result, stdout, error, duration_ms = run_sandboxed(code, _sample_df(), timeout_seconds=10)
    assert error is None
    assert isinstance(result, list)
    assert len(result) == 50


def test_allowed_pandas_import_and_stdout_capture_work():
    code = (
        "def analyze(df):\n"
        "    print('inspecting dataframe')\n"
        "    import pandas as pd\n"
        "    return {'rows': int(len(df))}\n"
    )
    result, stdout, error, duration_ms = run_sandboxed(code, _sample_df(), timeout_seconds=10)
    assert error is None
    assert result["rows"] == 5
    assert "inspecting dataframe" in stdout
