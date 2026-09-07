# FFmpeg Encoder — Roadmap

_Last updated: March 21, 2026_

---

This roadmap outlines the structured development path of the application.  
Each phase builds on the previous one, prioritizing **stability, clarity, and incremental progress**.

The goal is not rapid feature expansion, but a **reliable and maintainable encoding tool**.

---

## ✅ Phase 1 — Core Encoding Engine (Completed)

The foundational system is implemented and working.

Includes:
- Electron application structure (main + renderer)
- Folder selection (input/output)
- Sequential batch encoding
- FFmpeg execution via main process
- IPC communication between renderer and main
- Real-time telemetry (time, fps, speed, size)
- Progress bar driven by FFmpeg output
- Cancel encoding functionality
- UI transition (setup → monitor → completion)

This phase establishes the **core architecture and working pipeline**.

---

## 🔧 Phase 2 — Encoding Quality Controls

Focus: Make the encoder configurable through the UI.

Includes:
- CRF control (`-crf`)
- Preset control (`-preset`)
- Codec selection (`-c:v`)
- Basic parameter validation
- Passing settings from renderer → main via IPC
- Replacing hardcoded FFmpeg arguments with dynamic values

Goal:
> Transition from a fixed encoder into a **user-controlled encoding system**.

---

## 🛡️ Phase 2.5 — Security & Architecture Hardening

Focus: Strengthen system boundaries and long-term stability.

Includes:
- Enforcing strict renderer ↔ main separation
- Limiting renderer privileges (reduce direct system access)
- Validating all IPC inputs (paths, settings, requests)
- Ensuring FFmpeg execution is isolated to main process only
- Improving error handling and failure feedback
- Stabilizing cancel/restart behavior
- Preventing stale process states
- Preparing the app for safe sharing and long-term use

Goal:
> Convert the system from **working prototype → durable and safe application**.

---

## Phase 2.6 — UI Architecture & Responsiveness Refinement

**Objective:**
Improve the UI structure and ensure consistent usability across different screen sizes before expanding features.

**Includes:**
- Separate UI styling from `index.html` into a dedicated CSS file
- Enforce clear separation:
  - `index.html` → structure (what exists in the UI)
  - `styles.css` → layout & design (how it looks and scales)
  - `renderer.js` → UI behavior and interaction (user actions and state)
  - `main.js` → system execution layer (FFmpeg, OS access, process handling)
- Refactor layout to improve flexibility across:
  - different resolutions (720p → 4K)
  - different window sizes
  - different aspect ratios
- Adjust grid layouts and spacing for better adaptability
- Prevent UI from becoming too cramped (small screens) or too sparse (large screens)

**Important Constraints:**
- Do NOT move system logic into the renderer
- Maintain strict renderer ↔ main separation
- Do NOT redesign UI completely — refine, not rebuild
- Preserve current usability and workflow

**Result:**
A UI that scales cleanly, remains architecturally correct, and supports future expansion without rework.

---


## ⚙️ Phase 3 — Hardware Encoding Support

Focus: Add GPU acceleration support.

Includes:
- NVIDIA NVENC
- Intel Quick Sync (QSV)
- AMD AMF
- Hardware detection logic
- Conditional FFmpeg argument mapping

Goal:
> Improve performance while maintaining stability.

---

## 📊 Phase 4 — Advanced Telemetry & Monitoring

Focus: Improve visibility and feedback.

Includes:
- More accurate progress handling
- ETA estimation
- Bitrate display
- Better formatting of output size
- Cleaner telemetry parsing

Goal:
> Make encoding behavior **transparent and understandable**.

---

## 📁 Phase 5 — Queue Management Improvements

Focus: Better control over batch processing.

Includes:
- Queue preview before encoding
- File skipping
- Reordering files
- Retry failed files

Goal:
> Provide **control over batch workflows**, not just execution.

---

## 🎛️ Phase 6 — UI/UX Refinement

Focus: Improve usability and clarity.

Includes:
- Cleaner layout
- Better spacing and hierarchy
- Improved feedback messages
- More intuitive controls

Goal:
> Make the app **easy and comfortable to use daily**.

---

## 📦 Phase 7 — Packaging & Distribution

Focus: Prepare the app for use outside development.

Includes:
- Building distributable versions
- Bundling FFmpeg properly
- Path handling for production
- Basic installation readiness

Goal:
> Make the app **portable and usable on other systems**.

---

## 🔍 Phase 8 — Testing & Stability Pass

Focus: Final reliability improvements.

Includes:
- Edge case testing
- Invalid input handling
- Long encoding session testing
- Crash prevention
- General robustness improvements

Goal:
> Ensure the app is **stable under real-world usage**.

---

## 🏁 Final Phase — Completion & Freeze

Focus: Finalizing the project.

Includes:
- Minor fixes only
- No major new features
- Documentation updates
- Final cleanup

Goal:
> Reach a **stable, finished tool** that can be used long-term without constant changes.

---

# 🧠 Development Philosophy

- Build **incrementally**, not all at once  
- Prioritize **stability over features**  
- Keep architecture **clear and consistent**  
- Avoid premature complexity  
- Test every step before moving forward