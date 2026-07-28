# Capability: Save Derived Dataset

> **Deferred to Phase 2** (`spec/roadmap.md`). Phase 1 ships a labelled, non-functional "Save as new dataset" stub on the Ask screen.

## What It Does
Lets a user save the result of an analysis (a derived/cleaned view) back into their dataset library as a new, independently reusable and queryable dataset.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| query_run_id | UUID | Ask screen "Save as new dataset" action | yes |
| new dataset name | string | Save dialog | yes |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| new `Dataset` row (`source_type="derived"`, `derived_from_query_run_id`) | DB row + Parquet file | `datasets` table + `AGENT_DATASET_STORE_DIR` |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| `DataSource` | re-run the query's analysis over the full (uncapped) data and materialize the result as Parquet | failure → 500, original `QueryRun` is unaffected |

## Business Rules
- The saved dataset behaves exactly like an uploaded one: independently profiled, listed, and queryable — including itself being save-as-able again.
- If the original `QueryRun`'s result was capped (`head(50)`), saving re-executes the underlying code against the full dataset rather than persisting only the capped preview.

## Success Criteria
- [ ] Saving an analysis result creates a new dataset that appears in the Datasets list and has its own accurate profile.
- [ ] The saved dataset can be queried independently in a new question, returning results consistent with its (correctly materialized) full data.
