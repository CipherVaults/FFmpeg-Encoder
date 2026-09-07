# Project Pipeline
(Originally Written on March 21st, 2026)

This document defines the current pipeline of software projects discussed and evaluated as part of the broader AI-assisted development workflow.

Its purpose is to:

- preserve the order and reasoning behind each project
- clarify what each project is actually trying to solve
- record feasibility and complexity judgments
- provide a reliable reference for future continuation
- help reconnect quickly with any of these projects later

This is not a roadmap for one single application.

It is a **project queue and strategic pipeline** for multiple future tools, ordered by realism, value, and increasing complexity.

---

# Core Principle

These projects are not random app ideas.

They are **personal tools designed to remove friction from real life workflows**.

The goal is not to build software for the sake of software.

The goal is to build:

- tools that solve real recurring frustrations
- local-first tools where useful
- systems that reduce dependence on cloud services or awkward existing software
- projects that progressively build capability, architectural understanding, and development discipline

The order of this pipeline matters.

Each project helps prepare the ground for the ones after it.

---

# Execution Order

The current recommended order is:

1. Percentage Calculator
2. Finance Entry App
3. Daily Planner
4. Discord-like Local Notebook

This order is based on:

- feasibility with the current AI-assisted workflow
- complexity of architecture
- UI difficulty
- practical usefulness
- value as preparation for later projects

---

# Project 1 — Percentage Calculator

## Status
Planned

## Priority
Very high as a small, fast side project

## Complexity
Low

## Role in the pipeline
This is the **quick win project**.

It is intended to be one of the simplest complete projects that can be built end-to-end with minimal architectural risk.

Its main purpose is not only practical use, but also to reinforce the development workflow through a project that is easy to finish, easy to test, and easy to validate.

## Problem it solves
There is a repeated need for predefined percentage calculations, but the current solution depends on an online website.

That creates several problems:

- internet dependency
- possible downtime
- no ownership
- inconvenience for something that should be simple and instant

## Intended form
A small local calculator app focused specifically on percentage operations.

Not a full scientific calculator.
Not a general math system.

A focused utility.

## Core functionality
Examples of intended calculations include:

- What is X% of Y?
- X is what percent of Y?
- X is Y% of what number?
- Percentage increase/decrease calculations

## Why this project matters
This project is important because it is:

- easy to validate
- low risk
- immediately useful
- a strong confidence-building project
- a good test case for very fast AI-assisted tool creation

## Architectural judgment
This project is a strong **green-light project**.

It does not need complex backend architecture.
It does not need Electron at first unless desired later.
It can begin as a clean local HTML/CSS/JavaScript tool.

## Main caution
Do not over-expand it into a full calculator platform.

Its strength is that it is focused and fast.

---

# Project 2 — Finance Entry App

## Status
Planned

## Priority
High

## Complexity
Low-to-medium

## Role in the pipeline
This is the **first serious structured app** after the quick-win calculator.

It is more important practically than the calculator, but also slightly more complex because it introduces structured data, persistent records, category systems, and export workflows.

## Problem it solves
Excel and spreadsheet-style budgeting tools are powerful, but they create too much friction for everyday manual entry.

The real pain is not analysis itself.

The pain is:

- entering purchases
- categorizing them
- recording them consistently
- updating entries without friction

The desired system is one where the user can log financial activity easily, and later export the structured data for analysis in Excel or Power BI.

## Intended form
A local desktop-style finance entry tool.

It should act as a **frictionless data-entry layer**, not as an Excel replacement.

## Core functionality
Version 1 would likely include:

- item name
- amount/cost
- category
- date
- optional notes
- editable category system
- transaction list/table
- filtering by category/date/month
- export to CSV or spreadsheet-friendly format

## Why this project matters
This is a very strong practical project because it combines:

- real-life usefulness
- manageable scope
- structured data modeling
- future compatibility with external analysis tools

It also introduces a new layer of skill:
not just calculation, but **organized data entry and export**.

## Architectural judgment
This project is also a strong **green-light project**, with more structure than the calculator.

It should not become:

- an Excel clone
- a spreadsheet UI
- a budgeting empire
- a full accounting suite

The winning version is:

> a clean finance-entry system with structured storage and export

## Main caution
Do not turn this into “Excel but easier.”

That would dramatically increase complexity and reduce clarity.

The app should focus on:
- entry
- organization
- export

not spreadsheet behavior.

---

# Project 3 — Daily Planner

## Status
Planned

## Priority
Medium

## Complexity
Medium to high, mostly due to UI and interaction design

## Role in the pipeline
This is the **first strongly UI-driven project**.

It moves the workflow from simple structured tools into interactive visual systems.

## Problem it solves
There is a need for a planner that visually represents time allocation across the day in a much more intuitive way than typical planner or notes apps.

The goal is not just note-taking.

The goal is to:

- allocate time blocks deliberately
- visualize the structure of the day
- track completion
- understand how time is actually being used

## Intended form
A visual planning application centered around time blocks assigned to a 24-hour day.

The original concept included:

- a large circular or clock-like time representation
- color-coded tasks
- start/end times
- visual occupation of the day
- completion marking
- possible dragging/moving of tasks later

## Core functionality
The stable version 1 should be reduced significantly and likely start with:

- task title
- start time
- end time
- task color
- visual placement on a daily timeline
- completion toggle
- current time indicator
- local persistence for the day

## Why this project matters
This project is important because it explores:

- visual representation of structured data
- planning as a spatial system
- state-heavy UI interaction
- personal workflow design

It is much more ambitious in the UI sense than the earlier projects.

## Architectural judgment
This project is **yellow**.

It is feasible, but only if the first version is aggressively simplified.

It becomes risky if the full dream version is attempted immediately.

The most dangerous parts are:

- circular timeline rendering
- drag-and-drop time editing
- interactive movement on a clock-like UI
- future multi-day/history/calendar layers

## Main caution
Do not start with the final vision.

The planner should begin as:
- reduced
- stable
- clear
- interaction-light

Then evolve later.

This is a project where:
> version 1 discipline is critical

---

# Project 4 — Discord-like Local Notebook

## Status
Planned for much later

## Priority
Low for now, high long-term value

## Complexity
High

## Role in the pipeline
This is the **flagship advanced project**.

It is the most ambitious of the discussed projects and should be treated as a future system, not a near-term side build.

## Problem it solves
Discord’s structure has proven unusually effective as a personal note/logging system because of:

- channel-based organization
- fast switching between topics
- timeline-style storage
- timestamps
- easy text/image posting
- lightweight markdown behavior
- frictionless capture

But the current use of Discord creates major problems:

- online dependency
- privacy concerns
- security concerns
- no true local ownership of the data
- not actually designed as a personal offline notebook

## Intended form
A local-first desktop application inspired by Discord’s structure and interaction patterns, but not a real chat platform.

This is **not** meant to be a Discord competitor.

It is meant to be:

> a personal, local, channel-based notebook and knowledge/logging system

## Core functionality
A realistic early version would include:

- one local workspace
- categories / channel list
- per-channel message-style timeline
- timestamps
- text entry
- image support
- local persistence
- easy navigation between channels

## Why this project matters
This may be the most personally valuable long-term project because it directly addresses:

- note-taking friction
- organization of ideas
- channelized topic separation
- local ownership of deeply personal information

It also reflects a highly specific and unusual software need that existing tools do not satisfy cleanly.

## Architectural judgment
This project is **yellow leaning toward red if poorly scoped**.

It is feasible only if it remains:

- local
- single-user
- offline-first
- not a true communication platform

The moment it becomes:
- real-time
- multi-user
- networked
- sync-heavy
- Discord-clone oriented

it moves toward red territory.

## Main caution
This project must not be described internally as:

- “build Discord”
- “make a clone”
- “recreate everything”

It must be described as:

> build a local knowledge system inspired by Discord’s structure

That framing is critical for survival.

---

# Pipeline Logic

This sequence is intentional.

## 1. Percentage Calculator
Teaches:
- fast iteration
- simple logic tools
- clean completion

## 2. Finance Entry App
Teaches:
- structured records
- persistence
- export workflows
- practical utility design

## 3. Daily Planner
Teaches:
- more advanced UI state
- visual layout logic
- interaction-heavy thinking

## 4. Discord-like Local Notebook
Demands:
- stronger information architecture
- local persistence design
- scalable internal structure
- long-term system thinking

Each project is a step upward in:

- system complexity
- UI difficulty
- architectural responsibility

---

# Relationship to FFmpeg Encoder

The FFmpeg Encoder remains a separate major project and current primary development system.

This pipeline does not replace it.

Instead, these projects exist as:

- side tools
- future tool builds
- capability progression steps
- experiments in applying the same AI-assisted development methodology to different software classes

The FFmpeg project is currently the most developed example of this workflow in practice.

The other projects are future applications of the same overall method.

---

# Development Philosophy Across All Projects

These projects should all follow the same core methodology already established:

- start with the real problem
- define the smallest useful version
- avoid overbuilding version 1
- preserve architecture clarity
- validate step by step
- use AI as an implementation layer, not as blind authority
- prioritize durable systems over fast messy output

---

# Final Strategic View

This pipeline is not a random wishlist.

It is a structured sequence of:

- useful tools
- increasing complexity
- increasing architectural depth
- increasing learning value

It represents a long-term path for building software that directly serves Ahmed’s life, workflows, and curiosity.

The current order should remain:

1. Percentage Calculator
2. Finance Entry App
3. Daily Planner
4. Discord-like Local Notebook

Unless future constraints, learning, or project reality justify a reordering.