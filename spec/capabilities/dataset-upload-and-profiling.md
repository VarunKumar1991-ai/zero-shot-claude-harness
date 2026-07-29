# Capability: Dataset Upload and Profiling

## What It Does
Lets a logged-in officer upload a CSV of crime/FIR records, which the system parses, auto-profiles (columns, row count, date range, data-quality issues), and persists for repeated querying across sessions and days.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| CSV file | multipart file, up to ~500MB | Upload form | yes |
| Dataset display name | string | Upload form (defaults to filename) | no |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| Dataset profile | `{ columns: [{name, inferredType}], rowCount, dateRange: {min,max}, qualityFlags: [{type, count, sampleRowRefs}] }` | `GET /api/datasets/:id/profile` response, profile card UI |
| Persisted dataset record | row in `datasets` + `dataset_files` tables | SQLite |
| Stored original file | CSV on local disk | `storage/` directory, referenced by `dataset_files.filePath` |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| Local disk | Write uploaded file | Upload rejected with a clear error; no partial dataset record created |
| SQLite | Insert `datasets`/`dataset_files` rows | 500, logged; upload rejected, no orphaned file left on disk (best-effort cleanup) |

## Business Rules
- Column types (string/number/date) are inferred from a full-file scan, not a sample — inference must reflect the real data, not the first N rows.
- Malformed rows (unparseable dates, missing required-looking values, wrong column count) are detected during the full parse, counted per issue type, and reported as `qualityFlags` — never silently dropped from the persisted dataset.
- The officer must explicitly choose to exclude flagged bad rows (re-submits upload with `excludeBadRows: true`) or cancel and re-upload a fixed file; the system never auto-excludes without this confirmation.
- Datasets persist indefinitely (no auto-expiry in Phase 1/2) and remain queryable across sessions and days.
- File size is capped at 500MB; larger uploads are rejected with a clear error before parsing begins.

## Success Criteria
- [ ] Uploading a real FIR/crime CSV produces a profile with the correct column list, correct row count, and a date range matching the actual min/max date in the file.
- [ ] A CSV with deliberately malformed rows (bad date format, missing values) surfaces accurate quality-flag counts, not a silent drop.
- [ ] Re-opening a dataset on a later day (new session) still shows the same persisted profile without re-uploading.
- [ ] A 150MB file is rejected before parsing with a clear size-limit error.
