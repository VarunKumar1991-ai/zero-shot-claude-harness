# Capability: CSV Upload and Profiling

## What It Does
An officer uploads one CSV of FIR/crime records; the system validates it, converts it into a queryable columnar store, and immediately shows an auto-generated profile — columns, row count, date range, and detected data-quality issues — before any question is asked.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| CSV file | multipart file, ≤ `AGENT_MAX_CSV_MB` (default 100MB) | Upload screen | yes |
| display name | string | Upload screen (optional override) | no |
| uploader | session user | auth cookie | yes |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| `Dataset` record (`status="ready"`, `storage_path`) | DB row + Parquet file on disk | `datasets` table + `AGENT_DATASET_STORE_DIR` |
| `DatasetProfile` (columns/dtypes/stats, row_count, date_range, quality_issues) | DB row | `dataset_profiles` table, rendered on the Profile screen |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| Local filesystem | write staged CSV, write converted Parquet | disk error → `Dataset(status="failed")`, 500 with a clear message, never a partially-ready dataset |
| DuckDB/pandas (in-process, no LLM) | parse CSV, infer dtypes, compute profile stats and quality flags | malformed CSV (no columns detected) → 400 before any `Dataset` row is created |

## Business Rules
- Files larger than `AGENT_MAX_CSV_MB` are rejected up front with a message naming the limit — never silently truncated.
- Quality-issue detection auto-flags, per column: unparseable dates, missing/blank values, and type mismatches within a column (e.g. text in a mostly-numeric column) — each flag records the issue type, column, affected row count, and up to 3 real examples.
- No row is ever silently dropped or coerced: if the officer takes no explicit action, all rows are kept and the quality-issues panel remains visible as a standing warning (Assumed default, since the brief requires the choice to exist but does not mandate a Phase 1 default).
- Once converted, the dataset is queried from its Parquet form, not by re-parsing the original CSV — the raw CSV is not the copy served to the analysis layer.
- Datasets persist indefinitely; a dataset uploaded on one day is still present and queryable in a session days later.

## Success Criteria
- [ ] Uploading a real CSV of at least a few thousand rows returns a profile whose `row_count`, column names, and date range are verifiably correct against the source file.
- [ ] A CSV containing intentionally malformed dates and missing values in known cells surfaces exactly those issues (correct column, correct affected count) in `quality_issues`.
- [ ] A file above `AGENT_MAX_CSV_MB` is rejected with 400 and a message stating the limit; no `Dataset` row is created.
- [ ] After a server restart, a previously uploaded dataset is still listed and its profile is still retrievable (persisted, not in-memory).
