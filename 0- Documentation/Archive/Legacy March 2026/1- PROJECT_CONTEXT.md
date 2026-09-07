\# FFmpeg Encoder Desktop App — Project Context



\## Project Overview



This is a desktop application built using Electron that provides a graphical interface for FFmpeg to batch encode videos.



The application allows users to:



\* Select input/output folders

\* Encode multiple videos sequentially

\* Monitor encoding progress in real-time

\* Cancel encoding safely



\---



\## Current Architecture



Electron App:



Renderer Process (UI)



\* Handles user interaction

\* Displays encoding progress and telemetry

\* Sends encoding requests via IPC

\* Receives FFmpeg telemetry updates from main process



Main Process (Backend)



\* Launches FFmpeg using `child\_process.spawn`

\* Handles encoding jobs sequentially

\* Streams FFmpeg output (stderr) to renderer

\* Supports cancellation via `process.kill()`



FFmpeg:



\* Performs actual encoding

\* Outputs real-time telemetry:



&#x20; \* FPS (frames per second)

&#x20; \* Speed (relative to real-time)

&#x20; \* Time (encoded duration)

&#x20; \* Size (output size in kB)



\---



\## Features Implemented



\### Core Features



\* Folder selection (input/output)

\* Batch video detection (with supported formats)

\* Sequential encoding loop (one file at a time)

\* FFmpeg integration via IPC

\* Real-time telemetry parsing:



&#x20; \* FPS

&#x20; \* Speed

&#x20; \* Time

&#x20; \* Output size (currently in FFmpeg kB format)

\* Smooth UI updates (throttled refresh loop \~500ms)

\* Cancel encoding functionality (kills active FFmpeg process)

\* Start button protection (prevents double execution)



\---



\## UI Features



\### Setup Screen



\* Input folder selection

\* Output folder selection

\* Codec selector (UI only, not yet functional)

\* Preset selector (UI only)

\* Hardware selector (UI only)

\* CRF slider (UI only)



\### Monitor Screen



\* Progress bar (real, tied to encoding progress — not mock)

\* Current file name

\* File counter (File X of Y)

\* FPS / Speed / Size / Time display

\* Total runtime timer

\* Cancel button

\* Completion summary



\---



\## Known Limitations



\* Codec / preset / CRF are not yet connected to FFmpeg

\* Output size still displayed in FFmpeg format (kiB, not converted to MB yet)

\* No estimated remaining time

\* Hardware acceleration not implemented (CPU only)




\---



\## Current Development Stage



We have successfully completed:



\* Stable encoding pipeline

\* Sequential processing system

\* Real-time FFmpeg telemetry integration

\* Smooth UI update system (buffered rendering)

\* Cancel encoding system (safe process termination)

\* UI structure and monitoring system



The application is now \*\*functionally stable and usable\*\*, with remaining work focused on \*\*feature completion and accuracy improvements\*\*.



\---



\## Next Steps (Priority Order)



1\. Make CRF slider functional (connect to FFmpeg `-crf`)

2\. Connect preset selector to FFmpeg (`-preset`)

3\. Connect codec selector (`libx264`, `libx265`, etc.)

4\. Improve progress accuracy (true % based on duration)

5\. Convert output size from kB → MB/GB (user-friendly display)

6\. Add estimated remaining time

7\. Add hardware encoder support:



&#x20;  \* NVIDIA NVENC

&#x20;  \* Intel QSV

&#x20;  \* AMD AMF



\---



\## Key Files



\* main.js → Handles FFmpeg execution, IPC, and process control

\* renderer.js → UI logic, telemetry parsing, and display updates

\* index.html → UI structure and styling (CSS embedded internally)



\---



\## Development Approach



This project is being built through AI-assisted development:



Human (Ahmed):



\* Defines goals and product direction

\* Tests behavior and identifies issues

\* Guides decisions and priorities



AI (ChatGPT 5.3 + DeepSeek):



\* Writes and explains code

\* Debugs and fixes issues

\* Designs system architecture

\* Translates ideas into implementation



This represents a \*\*modern AI-assisted development workflow\*\*, where human intent drives AI execution.



\---



\## Important Notes



\* FFmpeg is the core engine — the app is a control interface

\* All encoding is sequential (not parallel) for stability

\* UI is designed for clarity and usability over complexity

\* System is built incrementally with validation at each step

\* Current focus is transitioning from "working system" → "fully configurable encoder"



