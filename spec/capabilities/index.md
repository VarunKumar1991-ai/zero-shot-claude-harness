# Capabilities Index

## What Is a Capability?

A capability is a single, discrete action or behavior the agent performs.

## Capabilities in This Project

### Phase 1 (built now)

| Capability | File |
|-----------|------|
| Officer Authentication | [officer-authentication.md](officer-authentication.md) |
| CSV Upload and Profiling | [csv-upload-and-profiling.md](csv-upload-and-profiling.md) |
| Conversational Data Q&A | [conversational-data-qa.md](conversational-data-qa.md) |
| Server-Side Audit Trail | [server-side-audit-trail.md](server-side-audit-trail.md) |

### Phase 2 — Multi-File Analysis + Persistent Context

| Capability | File |
|-----------|------|
| Multi-File Join and Combine | [multi-file-join-and-combine.md](multi-file-join-and-combine.md) |
| Dataset Annotations | [dataset-annotations.md](dataset-annotations.md) |
| Save Derived Dataset | [save-derived-dataset.md](save-derived-dataset.md) |

### Phase 3 — Rich Output + Guided Exploration

| Capability | File |
|-----------|------|
| Interactive Charts | [interactive-charts.md](interactive-charts.md) |
| Exportable Report | [exportable-report.md](exportable-report.md) |
| Follow-Up Suggestions | [followup-suggestions.md](followup-suggestions.md) |

### Future (not phase-planned — see `spec/roadmap.md` → Future Direction)

- MySQL data source (production DB integration, read replicas, caching)
- Per-user / role-based dataset isolation

## How to Add a New Capability

Run `/zero-shot-build [description]` on the existing spec. The spec-writer sub-agent will:
1. Create a new file in this directory (`<name>.md`, no number prefix)
2. Update this index
3. Flag any dependencies on existing capabilities
4. Self-review that it fits the architecture and data model before returning

## Capability File Template

Each capability file should answer:
- **What it does** (one sentence)
- **Inputs** (what data it receives)
- **Outputs** (what it produces)
- **External calls** (APIs, LLMs, databases it touches)
- **Business rules**
- **Success criteria** (how we test it)
