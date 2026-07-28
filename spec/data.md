# Data Model

---

## Storage Technology

SQLite (file-based, `data/agent.db`), accessed via **Sequelize** ORM with **sequelize-cli** migrations (`migrations/`). Chosen for Phase 1/2 local/single-instance simplicity while keeping a dialect-swappable ORM layer so a future MySQL production data source can be introduced by changing the Sequelize dialect/connection config, not by rewriting models or queries (see `architecture.md`). Uploaded CSV originals are stored on local disk under `storage/datasets/<datasetId>/`, referenced by path from `dataset_files`.

## Entities

### Entity: User

A police officer's local login account, used purely for audit attribution (no per-user data isolation in Phase 1/2).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (string) | yes | Primary key |
| username | string | yes | Unique login name |
| passwordHash | string | yes | bcrypt hash, never plaintext |
| displayName | string | no | For UI attribution (e.g. "Insp. Rao") |
| createdAt | timestamp | yes | |

### Entity: Dataset

A logical dataset an officer can query — either a single uploaded CSV, or (Phase 2) multiple combined/joined files.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (string) | yes | Primary key |
| name | string | yes | Display name (defaults to filename) |
| createdByUserId | UUID (FK → User.id) | yes | Uploader, for attribution |
| rowCount | integer | yes | Computed at profiling time |
| columns | JSON | yes | `[{name, inferredType}]` |
| dateRangeMin | date, nullable | no | Earliest detected date column value |
| dateRangeMax | date, nullable | no | Latest detected date column value |
| qualityFlags | JSON | yes | `[{type, count, sampleRowRefs}]` |
| combineStrategy | string, nullable | no | Phase 2: `"single"` \| `"schema_combined"` \| `"joined"` |
| derivedFromQueryId | UUID (FK → Query.id), nullable | no | Phase 2: set when this dataset was saved from an analysis result |
| createdAt | timestamp | yes | |
| updatedAt | timestamp | yes | |

### Entity: DatasetFile

One uploaded CSV file backing a Dataset (a Dataset may have >1 File once Phase 2 multi-file combine ships; Phase 1 always has exactly one).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (string) | yes | Primary key |
| datasetId | UUID (FK → Dataset.id) | yes | |
| originalFilename | string | yes | |
| filePath | string | yes | Path under `storage/datasets/<datasetId>/` |
| fileSizeBytes | integer | yes | |
| rowCount | integer | yes | Rows contributed by this file |
| uploadedAt | timestamp | yes | |

### Entity: Query (Audit Log)

One record per question asked against a dataset — the full audit trail entry.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (string) | yes | Primary key, matches the agent graph's `runId` |
| datasetId | UUID (FK → Dataset.id) | yes | |
| userId | UUID (FK → User.id) | yes | Who ran it |
| sessionId | string | yes | Groups turns for conversation history (Phase 2) |
| question | text | yes | Officer's natural-language question |
| complexity | string, nullable | no | `"simple"` \| `"complex"` \| `"needs_clarification"` |
| plan | JSON, nullable | no | Ordered plan steps, if complex |
| generatedCode | text, nullable | no | Final code attempt |
| attempts | JSON | yes | `[{code, executionResult, inspection}]` — full retry history |
| result | JSON, nullable | no | Computed result (numbers/small table) |
| answer | text, nullable | no | Final plain-language answer |
| keyNumbers | JSON | yes | `[{label,value}]` |
| assumptions | JSON | yes | Flagged assumptions, if any |
| chartSpec | JSON, nullable | no | Phase 2 |
| followups | JSON | yes | Phase 2 (Phase 1: always `[]`) |
| tokenUsage | JSON | yes | `{promptTokens, completionTokens}` |
| status | string | yes | `"completed"` \| `"failed"` \| `"needs_clarification"` |
| error | text, nullable | no | Populated on failure |
| createdAt | timestamp | yes | Run start |
| completedAt | timestamp, nullable | no | Run end |

### Entity: Annotation *(Phase 2 — table created in Phase 1 migration as a stub, unused until Phase 2)*

A user-provided note about a column/business rule that persists and improves future answers on a dataset.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID (string) | yes | Primary key |
| datasetId | UUID (FK → Dataset.id) | yes | |
| createdByUserId | UUID (FK → User.id) | yes | |
| columnName | string, nullable | no | Column the note applies to, if column-specific |
| note | text | yes | e.g. "IPC_Section = offence code" |
| createdAt | timestamp | yes | |

> **Assumed:** the `annotations` table is created by the Phase 1 migration (empty, unused) rather than added in a Phase 2 migration, so the Phase 1 `load_context` node's read of `annotations` (always `[]` in Phase 1) needs no schema change later — a deliberate forward-compatible stub, not a functional Phase 1 capability.

### Relationships

- `User` 1—N `Dataset` (via `createdByUserId`)
- `User` 1—N `Query` (via `userId`)
- `Dataset` 1—N `DatasetFile`
- `Dataset` 1—N `Query`
- `Dataset` 1—N `Annotation`
- `Dataset` 0—1 `Query` (via `derivedFromQueryId`, Phase 2 save-as-dataset lineage)

## Data Lifecycle

- **Users:** created only via `npm run migrate`'s seed script in Phase 1/2 (no self-service signup). Never deleted.
- **Dataset / DatasetFile:** created on upload; persist indefinitely (no auto-expiry) so officers can return to the same dataset across days, per the brief. No delete endpoint in Phase 1/2 (out of scope; audit integrity favors append-only for now).
- **Query:** created at the start of every agent run (`load_context`), updated at `finalize`/`handle_error`. Never deleted or edited by any endpoint — permanent audit record.
- **Annotation:** created/updated by the officer in Phase 2; persists indefinitely, read by `load_context` on every subsequent query against that dataset.

## Sensitive Data

- `passwordHash` — bcrypt hash only, never logged or returned by any API response.
- Uploaded CSV contents (crime/FIR records) are sensitive case data: stored on local disk (not sent to any third party except the bounded LLM-prompt content described in `architecture.md`'s data-residency constraint — schemas, ≤20-row samples, and computed/aggregated results only, never full raw rows).
- `Query.generatedCode`/`result`/`attempts` may contain small excerpts of case data if the LLM's generated code echoes sample values into its output — the `synthesize_answer` node is constrained (via prompt) to reference only aggregated figures in the officer-facing answer, but the audit log's `attempts`/`result` fields are internal-only (not exposed to any endpoint beyond authenticated officers) and are treated with the same sensitivity as the source CSVs.
