# PBS context and documentation migration

## Why this file exists

Ahmed asked Codex to understand the Project Bootstrap System (PBS) and real project documentation before resuming this legacy application. His execution amendments explicitly reject copying the entire canonical PBS into this repository by default. The local adaptation is `AGENTS.md` plus this short provenance record. It preserves enough context to understand the method without loading unrelated material every time.

PBS principles used here are: documentation follows implementation reality, each document owns a distinct question, execution and session history serve different purposes, reporting is proportional to meaningful work, and agents use the smallest sufficient context. The full templates remain references rather than mandatory sections to fill with empty text.

## External provenance

| Source | Use |
|---|---|
| `G:\AI Directed Software Development\[Documentation] AI Project Bootstrap System (PBS)\AI PBS Markdown files [Work in Progress]` | Canonical PBS source, including Documentation System Overview v2.0, Universal Codex Operating Rules v2.0, Codex layer guidance, Execution Summary Template v1.1, Session Summary Template v1.0, roadmap, and meta-history. |
| `D:\Codex Projects\The Local AI Project\1- References\PBS` | Existing project reference copies and manifest; comparison/context only. |
| `D:\Codex Projects\The Local AI Project\0- Documentation` and its root AGENTS | Example of current-state inventory, continuity, and explicit local boundaries. Its separate per-install approval policy is not imported into FFmpeg. |
| `G:\AI Directed Software Development\AI Ambassadors GP - Project #7\Documentation` | Reference for architectural explanations, project decisions, and cumulative session narratives. |
| `G:\The Freelancing Arc\The-Freelancing-Arc-GitHub\0- Documentation` | Reference for distinct architecture/current-state/roadmap responsibilities and detailed pause-point history. |
| `D:\Codex Projects\HDD Backup Checklist and Map\Personal Backup Operations — Execution Summary.md` | Reference for concrete actions, verification, uncertainty, and Git/external-system reporting. |

These external paths are machine-specific reference pointers. Availability may change. None of their files is copied into the FFmpeg repository by this bootstrap. If a later concrete need justifies a PBS copy, record the exact source, version/date, hash, purpose, and whether it is frozen or maintained. Do not import another project's product scope, credentials, personal context, or approval restrictions.

The controlling Notion handoff is [Codex Grand Re-Entry & Autonomy Test — September 6, 2026](https://app.notion.com/p/3d3bd7ade63b8182bacad5f867b4d134), a child of FFmpeg Encoder Desktop App. Ahmed's approved plan amendments in this task govern subsequent execution; historical handoff text does not override those amendments.

## Historical preservation and active destinations

The original `Context Files for ChatGPT/Documentation` remains unchanged in the preserved original, full backup, and local working copy. For versioned project history, Markdown documents and the two documentation prompt templates are copied byte-for-byte to `Archive/Legacy March 2026`, maintaining their relative subdirectories. Media, chat HTML exports, and unrelated raw context are not included in this archival copy. `Archive/legacy-documentation-manifest.json` records source-relative paths, byte counts, and SHA-256 values.

| Historical source | Current purpose/destination |
|---|---|
| `1- PROJECT_CONTEXT.md` | Identity and current facts split into Architecture and Current State. |
| `2- ARCHITECTURE.md` | Architecture re-explained around actual legacy evidence and approved ownership changes. |
| `3- TECHNICAL.md` | Technical Reference owns current media/process contracts; historical command remains identified. |
| `4- CONTRIBUTING.md` | Project-local operating guidance in root AGENTS and verification guidance in Security and Testing. |
| `5- README.md` | Root README becomes the short entry point. |
| `6- Changelog.md` | Root CHANGELOG continues 0.1–0.4 and records scaffold-version correction. |
| `7- ROADMAP.md`, old roadmap | Active Roadmap maps historical phases to approved milestones; old versions remain archival. |
| `8- SESSION_SUMMARY.md` | Exact original text appended as a clearly historical section to cumulative Session Summary, with new entries above it. |
| `HOW_THIS_PROJECT_WORKS_FOR_BEGINNERS.md` | New beginner guide explains responsibilities and workflow without obsolete security claims. |
| `Project Pipeline.md` | Historical process reference; applicable ideas reflected in AGENTS and this provenance document. |
| `Prompts/*.txt` | Exact archival templates; not binding current instructions. |

Preservation does not mean endorsement of every historical claim. Examples requiring correction in active docs include “safe cancellation,” “stable pipeline,” and “main is the only component touching the operating system.” Source inspection and baseline defect characterization show why those claims need a new implementation and fresh tests.

## Reading and maintenance

Routine re-entry starts with AGENTS, Current State, the newest Session Summary, and relevant architecture/code. Read execution reports by milestone through their index. Read historical documents only for a specific decision or discrepancy. Keep session history cumulative and execution reports dated per milestone, as Ahmed's latest amendment allows; this deliberately differs from the Local AI project's single cumulative execution file.
