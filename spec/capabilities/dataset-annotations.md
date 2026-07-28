# Capability: Dataset Annotations

> **Deferred to Phase 2** (`spec/roadmap.md`). Phase 1 ships a labelled, non-functional annotation-editor stub on the Profile screen.

## What It Does
Lets a user annotate a column with business-rule context (e.g. "IPC_Section = offence code") that persists on the dataset and is included in future questions' context so the agent interprets ambiguous terms correctly.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| dataset_id, column_name, note | strings | Profile screen annotation editor | yes |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| `DatasetAnnotation` row | DB row | `dataset_annotations` table |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| SQLite | CRUD on `DatasetAnnotation` | DB error → 500 |

## Business Rules
- Annotations are per-dataset and per-column; a dataset may have multiple annotations across different columns.
- `load_context` (`spec/agent.md`) includes all of a dataset's annotations in `generate_code`/`synthesize_answer` prompt context.

## Success Criteria
- [ ] Adding an annotation for a column persists it, and it is visible when re-opening the dataset profile in a later session.
- [ ] A question referencing a term defined only in an annotation (e.g. "IPC_Section") resolves correctly after the annotation is added, where it previously required clarification.
