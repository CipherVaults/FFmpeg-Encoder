# Roadmap

This document outlines the planned evolution of the FFmpeg Batch Encoder UI.

The roadmap is divided into development phases.  
Each phase represents a major architectural or usability milestone.

The goal is to evolve the application from a minimal encoding tool into a robust media processing interface.

---

# Vision

The long-term goal of this project is to create a clean, stable, and efficient desktop interface for FFmpeg batch encoding.

The application focuses on

- high-quality video compression
- batch automation
- transparency of encoding telemetry
- simple and predictable workflow

Unlike many encoding tools, the design prioritizes clarity and reliability over feature overload.

---

# Phase 1 — Core Encoding Engine (Completed)

This phase established the fundamental encoding pipeline.

### Implemented

- Electron desktop application
- UI configuration panel
- Inputoutput folder selection
- Batch video detection
- Sequential encoding pipeline
- FFmpeg integration
- Real-time telemetry parsing
- Encoding progress monitoring
- Cancel encoding functionality

### Technical Achievements

- IPC communication between renderer and main process
- `child_process.spawn()` based FFmpeg execution
- Real-time telemetry streaming
- Regex parsing of FFmpeg progress data
- Progress bar synchronization with encoding progress

---

# Phase 2 — Encoding Quality Controls

Next development phase introduces configurable encoding parameters.

### Planned Features

- CRF slider integration with FFmpeg command
- Preset selection (slow  medium  fast)
- Codec selection (H264  H265)
- Hardware encoder selection
- saving last used folder location & encoding settings used

### Expected Benefits

Users gain control over

- encoding quality
- compression efficiency
- encoding speed

### Technical Work

- dynamic FFmpeg argument generation
- UI control binding
- encoder parameter validation

---

# Phase 3 — Hardware Encoding Support

Introduce GPU acceleration support.

### Planned Encoders

NVIDIA NVENC

```

hevc_nvenc
h264_nvenc

```

Intel Quick Sync

```

hevc_qsv
h264_qsv

```

AMD AMF

```

hevc_amf
h264_amf

```

### Goals

- dramatically increase encoding speed
- reduce CPU usage
- support modern GPU pipelines

### Technical Challenges

- encoder capability detection
- different parameter requirements
- hardware compatibility handling

---

# Phase 4 — UI Improvements

Improve usability and workflow.

### Planned Improvements

- tooltips explaining encoder settings [buttons on the side of the main page to open the help page possibly]
- about section (Github page possibly and date of creation and version)
- output size in MBs and GBs dynamically [not KiB]
- estimated remaining time
- no tool bar above in the UI (it's not needed)


---

# Phase 5 — Encoding Profiles

Introduce reusable encoding presets.

### Example Profiles

High Quality Archive

```

H265
CRF 20
Preset slow

```

Balanced Compression

```

H265
CRF 25
Preset medium

```

Fast Encode

```

H264
Preset fast

```

### Benefits

Users can quickly apply optimized configurations without adjusting every parameter.



---


# Phase 6 — File Handling Enhancements

Improve batch management.

### Planned Features

- duplicate detection
- overwrite protection
- automatic output folder creation
- automatic filename conflict resolution


---


# Phase 7 — Conversion Tool & different output formats
[button on the side that leads to the conversion page - we will design in when we get to this phase]

Convert from one Container to another (e.g ts to MP4)

- convert videos without encoding them from one container to another
- add to the main page of the encoding page, the choice of what format the output would be [e.g mp4,mov,mkv..etc] 

---

# Phase 8 — Advanced Telemetry

Expand the monitoring system.
[ Design Suggestion: we can make it in another sliding window on the side]

### Planned Metrics

- bitrate estimation
- encoding ETA
- CPU usage
- memory usage
- disk throughput

### Visualization Improvements

- smoother telemetry graphs
- speed trend monitoring
- compression ratio tracking


---

# Phase 9 — Encoding Queue System

Introduce a persistent job queue.

### Features

- multiple encoding batches
- pause resume queue
- reorder jobs
- queue progress overview

### Benefits

- long unattended encoding sessions
- multi-project processing
- improved workflow automation

### Technical Work

- queue manager module
- job state tracking
- UI queue panel





# Design Philosophy

The roadmap prioritizes

- stability
- transparency
- simplicity

The project intentionally avoids unnecessary complexity.

Each phase builds upon a stable foundation rather than introducing fragile features.

---

# Contribution Guidelines

Future contributors should aim to

- maintain architectural clarity
- document major changes
- preserve deterministic encoding behavior
- avoid unnecessary coupling between UI and encoding logic

---

# Current Status

Current development stage

```

Phase 1 — Core Encoding Engine

```

The application already supports

- batch encoding
- real telemetry monitoring
- cancellation
- sequential encoding
- progress visualization

Future work will expand encoding flexibility and hardware acceleration support.

```

