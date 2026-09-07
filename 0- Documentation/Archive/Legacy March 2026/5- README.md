
# FFmpeg Batch Encoder UI
A desktop batch video encoder built with **Electron** and **FFmpeg**, designed to provide a simple graphical interface for high-quality CPU video encoding workflows.
The application allows users to select a folder of video files and automatically encode them sequentially using optimized FFmpeg parameters while displaying real-time encoding telemetry such as FPS, encoding speed, progress, output size, and runtime.
This project was created as both a **practical encoding tool** and a **learning exploration of Electron, Node.js process management, and FFmpeg telemetry parsing**.
---
# Overview
FFmpeg is one of the most powerful video processing tools available, but it is primarily controlled through the command line.
While command-line workflows are efficient for experienced users, they can become cumbersome when:
- encoding large numbers of files
- monitoring encoding progress
- managing input/output directories
- cancelling jobs safely
This project provides a lightweight desktop interface that simplifies batch encoding while still leveraging the full power of FFmpeg.
The application focuses on **high-quality CPU encoding using libx265**, prioritizing compression efficiency and image quality.
---
# Key Features
## Batch Encoding
Automatically detects supported video files in a selected input folder and processes them sequentially.
Supported formats include:
- `.mp4`
- `.mkv`
- `.mov`
- `.avi`
- `.webm`
Files are sorted alphabetically to ensure deterministic processing order.
---
## Sequential Encoding Pipeline
Videos are encoded **one at a time**, preventing CPU oversubscription and maintaining stable performance.
This is particularly important for CPU encoders such as:
- `libx264`
- `libx265`
which are capable of utilizing all available CPU cores.
---
## Real-Time FFmpeg Telemetry
The application parses FFmpeg output to display live encoding statistics:
- encoding FPS
- encoding speed multiplier
- encoded output size
- current encoding timestamp
- total runtime
These values are extracted directly from FFmpeg's output stream using regular expression parsing.
---
## Accurate Progress Calculation
The progress bar is driven by **real encoding progress**, not simulated progress.
Progress is calculated using:
current_encoding_time / total_video_duration

This ensures the progress indicator accurately reflects the state of the encoder.
---
## Job Cancellation
Encoding can be safely stopped at any time.
When the cancel button is pressed:
1. The renderer sends a cancel request via IPC.
2. The main process terminates the running FFmpeg process.
3. The UI resets to the setup screen.
This prevents orphan FFmpeg processes.
---
## Output File Naming
Encoded files follow a clear naming convention:
originalfilename_H265-CPU.mkv

Example:
clip.mov → clip_H265-CPU.mkv

This makes it easy to distinguish encoded files from originals when working within the same directory.
---
# Encoding Settings
Current encoding configuration uses high-quality H.265 parameters.
FFmpeg command template:
ffmpeg -i input.mov
-c:v libx265
-preset slow
-crf 25
-tag:v hvc1
-x265-params aq-mode=3:psy-rd=2
-c:a copy
output_H265-CPU.mkv

Explanation of key parameters:
| Parameter | Description |
|--------|-------------|
| `libx265` | H.265 CPU encoder |
| `preset slow` | prioritizes compression efficiency |
| `crf 25` | constant rate factor controlling quality |
| `aq-mode=3` | adaptive quantization for perceptual quality |
| `psy-rd=2` | psycho-visual optimization |
| `tag:v hvc1` | compatibility tag for Apple devices |
| `-c:a copy` | copies audio stream without re-encoding |
---
# Project Architecture
The application follows the standard Electron architecture.
Renderer Process (UI)
│
│ IPC communication
▼
Main Process (system operations)
│
│ spawn FFmpeg
▼
FFmpeg Encoder

---
## Renderer Process
File:
renderer.js

Responsibilities:
- UI logic
- folder scanning
- telemetry display
- progress calculation
- sequential encoding control
- user interaction
---
## Main Process
File:
main.js

Responsibilities:
- launching FFmpeg
- handling OS dialogs
- managing child processes
- IPC communication
- process cancellation
---
## UI Layer
Files:
index.html

Provides:
- setup interface
- encoding monitor
- progress bar
- telemetry display
---
# Folder Structure
ffmpeg-ui/
│
├ main.js
├ renderer.js
├ index.html
│
├ ffmpeg/
│ └ ffmpeg.exe
│
├ README.md
├ ARCHITECTURE.md
├ TECHNICAL.md
└ CHANGELOG.md

The FFmpeg binary is bundled locally so the application does not depend on system-wide FFmpeg installation.
---
# Installation
## Requirements
- Node.js
- npm
- FFmpeg binary included in the project
---
## Install Dependencies
npm install

---
## Run the Application
npm start

This launches the Electron application.
---
# Usage
1. Launch the application
2. Select an **input folder** containing videos
3. Select an **output folder**
4. Click **Start Encoding**
The monitor screen will display:
- current file
- total files
- encoding progress
- encoding speed
- output size
- runtime
---
# Current Limitations
This version focuses on **CPU-based H.265 encoding**.
Future versions may include:
- GPU encoders (NVENC, QSV, AMF)
- codec selection (H264 / H265 / AV1)
- dynamic CRF control
- encoding presets from the UI
- pause/resume functionality
- job queue management
---
# Learning Goals
This project explores several technical concepts:
- Electron application architecture
- Node.js child process management
- FFmpeg telemetry parsing
- batch processing pipelines
- IPC communication
- real-time UI updates
---
# Roadmap sample 
Planned improvements:
- GPU hardware encoders
- AV1 encoding support
- encoding parameter customization
- encoding queue management
- performance optimizations
- cross-platform builds
---
# License
This project is intended as an educational and practical tool for exploring FFmpeg automation and Electron desktop applications.
License details can be defined in the future depending on project goals.
---
# Acknowledgments
This project relies on the incredible work of the FFmpeg community.
FFmpeg project:
https://ffmpeg.org/
