# Capability: Interactive Charts

> **Deferred to Phase 3** (`spec/roadmap.md`). Phase 1–2 ship a labelled, non-functional greyed-out chart placeholder under trend-shaped answers.

## What It Does
Renders trend/comparison answers (e.g. "thefts by month") as an interactive, zoomable/filterable bar/line/pie chart alongside the plain-language answer.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| chart spec (type, series, labels) | JSON | produced by a new `shape_chart_data` graph node, stored on `QueryRun` | no (only when the result is trend/comparison-shaped) |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| rendered chart | UI component | Ask screen, replacing the Phase 1–2 stub |

## External Calls
None beyond the existing query pipeline — chart data is derived from the same `execution_result` already computed, no additional LLM call required for the chart itself.

## Business Rules
- A chart is only shown when the result shape supports one (a time series or small categorical breakdown) — never forced onto a scalar answer.
- Chart data is the same aggregated/computed result already subject to the raw-row guardrail — no additional data exposure.

## Success Criteria
- [ ] A trend question ("thefts by month this year") renders a chart whose values match the underlying `key_numbers`/`execution_result`.
- [ ] A scalar-answer question (a single count) does not render an empty or broken chart placeholder.
