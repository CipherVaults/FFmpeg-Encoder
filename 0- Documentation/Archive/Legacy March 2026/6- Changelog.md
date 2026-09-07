\# Changelog



All notable changes to this project will be documented in this file.



This project follows a simplified version of the \*\*Keep a Changelog\*\* format.



Versioning is currently informal during development. Once the project stabilizes, semantic versioning may be introduced.



\---



\# \[Unreleased]



Future improvements and planned features.



\### Planned
(more details in the roadmap file, this is just a sample)


\- GPU encoder support (NVENC / QSV / AMF)

\- AV1 encoding option

\- Encoder profile presets

\- Batch encoding queue management

\- Drag-and-drop folder support

\- Encoding history

\- Output bitrate estimation

\- ETA estimation based on encoding speed

\- Advanced FFmpeg parameter editing

\- Automatic detection of hardware encoders



\---



\# \[0.4] — Real Telemetry Integration



Major milestone: transition from simulated telemetry to \*\*real FFmpeg telemetry parsing\*\*.



\### Added



\- Real-time telemetry parsing from FFmpeg stderr

\- FPS extraction

\- Encoding speed extraction

\- Output size tracking

\- Encoding time tracking

\- Total runtime timer



\### Improved



\- UI update loop redesigned to prevent flickering

\- Telemetry smoothing system introduced

\- Progress updates throttled to fixed refresh intervals



\### Technical



\- Implemented regex parsing for FFmpeg telemetry

\- Introduced telemetry cache object `latestFFmpegStats`

\- Added controlled UI refresh loop



\---



\# \[0.3] — Encoding Pipeline Implementation



Major milestone: full \*\*batch encoding pipeline\*\* implemented.



\### Added



\- Sequential batch encoding system

\- Folder scanning for supported video formats

\- Alphabetical file ordering

\- Automatic output filename generation

\- Real FFmpeg invocation from Electron



\### Technical



\- Implemented `child\_process.spawn()` for FFmpeg execution

\- Encoding loop uses async/await for sequential processing

\- IPC communication between renderer and main processes



\---



\# \[0.2] — Encoding Monitor UI



Major milestone: introduction of the encoding monitor interface.



\### Added



\- Encoding monitor page

\- File progress display

\- File counter (File X of Y)

\- Current file name display

\- Encoding telemetry display

\- Total runtime display

\- Completion summary screen



\### UI



\- Progress bar component

\- Telemetry display panel

\- Cancel encoding button



\---



\# \[0.1] — Initial Application Framework



Initial prototype and application foundation.



\### Added



\- Electron application setup

\- Renderer process UI

\- Main process system control

\- Folder selection dialog

\- Basic UI layout

\- Encoding settings panel



\### Technical



\- IPC communication structure

\- Application window initialization

\- Project folder structure



\---



\# Development Notes



This project was developed incrementally with an emphasis on:



\- clear architecture

\- controlled complexity

\- maintainability

\- learning-oriented development



Major development phases included:



1\. UI framework creation

2\. encoding pipeline implementation

3\. telemetry integration

4\. UI telemetry synchronization



\---



\# Acknowledgements



This project was developed as part of a deep learning exploration into:



\- Electron desktop applications

\- FFmpeg video encoding pipelines

\- Node.js process management

\- real-time telemetry parsing

\- batch media processing systems



```



\---





