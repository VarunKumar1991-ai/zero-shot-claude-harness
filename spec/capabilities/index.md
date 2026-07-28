# Capabilities Index

---

## What Is a Capability?

A capability is a single, discrete action or behavior the agent performs.

## Capabilities in This Project

| Capability | File | Phase |
|-----------|------|-------|
| Officer Authentication | [officer-authentication.md](officer-authentication.md) | 1 |
| Dataset Upload and Profiling | [dataset-upload-and-profiling.md](dataset-upload-and-profiling.md) | 1 |
| Natural-Language Question Answering | [natural-language-question-answering.md](natural-language-question-answering.md) | 1 |
| Audit Trail | [audit-trail.md](audit-trail.md) | 1 |

Phase 2 wires these Phase-1 UI stubs into real capabilities (each will get its own capability file when Phase 2 is planned in detail, per `/zero-shot-build`'s incremental-capability flow): multi-file combine/join, column annotations, charts, export, follow-up-question suggestions, conversation history, save-derived-dataset.

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
