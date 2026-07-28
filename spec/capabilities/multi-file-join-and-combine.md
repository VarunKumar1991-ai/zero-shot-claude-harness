# Capability: Multi-File Join and Combine

> **Deferred to Phase 2** (`spec/roadmap.md`). Phase 1 ships a labelled, non-functional "Combine with another file" stub on the Upload screen.

## What It Does
Lets a user query across multiple uploaded CSVs together (join/compare), and combine a set of files sharing the same schema (e.g. monthly exports) into one logical, jointly-queryable dataset.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| dataset_ids to combine | list of UUID | Combine screen | yes |
| group name | string | Combine screen | yes |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| `DatasetGroup` + `DatasetGroupMember` rows | DB rows | `dataset_groups`/`dataset_group_members` tables |
| combined query results | DB row (`QueryRun.dataset_group_id`) | Ask screen, scoped to the group |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| `DataSource` | schema-compatibility check across selected datasets | mismatched schemas → 400 naming the differing columns |

## Business Rules
- Only datasets with matching column names/dtypes can be combined into a logical group; joins across *different*-schema datasets are permitted for comparison questions but not silently unioned.
- `load_context`/`generate_code`/`execute_code` extend to a `datasets: dict[str, DataFrame]` namespace when a query targets a group (`spec/agent.md`), without changing the graph topology.

## Success Criteria
- [ ] Combining two same-schema monthly CSVs into a group and asking a question spanning both returns the sum across files, matching a hand-computed total.
- [ ] Attempting to combine two datasets with different schemas is rejected with a message naming the mismatched columns.
