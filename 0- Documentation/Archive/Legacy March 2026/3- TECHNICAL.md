\# Technical Reference



This document provides a detailed technical explanation of the internal implementation of the \*\*FFmpeg Batch Encoder UI\*\*.



It focuses on implementation details, algorithms, design choices, and the reasoning behind key decisions made during development.



This document is intended for developers who wish to:



\- modify the encoding pipeline

\- add new encoder profiles

\- extend UI functionality

\- integrate hardware encoders

\- understand FFmpeg telemetry handling





\---



\# Encoding Strategy



The encoder uses \*\*high-quality CPU video encoding\*\* based on the `libx265` encoder.



The design prioritizes:



\- compression efficiency

\- visual quality

\- predictable CPU utilization



This is achieved through \*\*Constant Rate Factor (CRF)\*\* encoding.



\---



\# CRF Encoding



CRF (Constant Rate Factor) controls perceptual quality rather than bitrate.



Lower values increase quality.



Typical CRF ranges:



| CRF | Quality |

|----|--------|

| 18 | Visually lossless |

| 20–24 | High quality |

| 25–28 | Medium compression |

| 30+ | Heavy compression |



The project currently uses:



```



CRF 25



```



This provides a balance between file size reduction and visual fidelity.



\---



\# FFmpeg Command Configuration



Current encoding command template:



```



ffmpeg -i input.mov 

\-c:v libx265 

\-preset slow 

\-crf 25 

\-tag:v hvc1 

\-x265-params aq-mode=3:psy-rd=2 

\-c:a copy 

output\_H265-CPU.mkv



```



\---



\# Parameter Breakdown



\## libx265



```



\-c:v libx265



```



Specifies the H.265 software encoder.



Advantages:



\- superior compression compared to H.264

\- better efficiency at lower bitrates

\- modern codec support



\---



\## Preset



```



\-preset slow



```



Encoder presets control the tradeoff between:



\- encoding speed

\- compression efficiency



Available presets range from:



```



ultrafast → placebo



```



Slower presets achieve better compression but require more CPU time.



\---



\## CRF



```



\-crf 25



```



Controls target visual quality.



The encoder dynamically adjusts bitrate to maintain this quality level.



\---



\## HVC1 Tag



```



\-tag:v hvc1



```



Ensures compatibility with Apple devices and certain media players.



Without this tag, some players interpret the codec incorrectly.



\---



\## Adaptive Quantization



```



\-x265-params aq-mode=3



```



Adaptive Quantization improves perceptual quality by allocating more bits to visually complex areas.



Mode 3 provides:



\- auto-variance AQ

\- improved texture preservation



\---



\## Psycho-Visual Optimization



```



psy-rd=2



```



Enhances visual quality by prioritizing perceptual detail over mathematical compression.



This helps preserve:



\- textures

\- edges

\- natural film grain



\---



\## Audio Copy



```



\-c:a copy



```



Audio streams are copied without re-encoding.



Benefits:



\- faster processing

\- avoids audio quality loss

\- preserves original audio format



\---



\# Encoding Pipeline



The encoding pipeline operates as a sequential batch processor.



Pipeline flow:



```



Input Folder

│

▼

Video File Detection

│

▼

Alphabetical Sorting

│

▼

Sequential Encoding Loop

│

▼

FFmpeg Process Execution

│

▼

Telemetry Streaming

│

▼

UI Progress Updates

│

▼

Next File



```



\---



\# File Detection



The renderer scans the input directory using Node.js:



```



fs.readdirSync()



```



Files are filtered by extension.



Supported formats include:



```



.mp4

.mkv

.mov

.avi

.webm



```



Unsupported formats are ignored.



\---



\# Deterministic Processing Order



Files are sorted alphabetically:



```



files.sort((a,b)=>a.localeCompare(b))



```



This guarantees predictable processing order.



Example:



```



clip1.mov

clip2.mov

clip3.mov



```



This behavior mirrors typical batch encoding scripts.



\---



\# Sequential Encoding Loop



Encoding is performed using a sequential loop:



```



for (let i = 0; i < videoFileList.length; i++)



```



Each file waits for the previous encoding process to complete.



Reasons for sequential processing:



\- CPU encoders already utilize all cores

\- parallel encoding reduces efficiency

\- system stability



\---



\# FFmpeg Process Launch



FFmpeg is launched via Node.js:



```



child\_process.spawn()



```



Example:



```



spawn("./ffmpeg/ffmpeg.exe", args)



```



`spawn()` is preferred over `exec()` because:



\- it streams output

\- it supports long-running processes

\- it avoids memory buffering limits



\---



\# Telemetry Stream



FFmpeg prints encoding progress continuously.



Example telemetry:



```



frame=  423 fps=23 q=28.0 size=1243kB time=00:00:17.32 speed=0.82x



```



This output is captured from:



```



stderr



```



\---



\# Telemetry Parsing



Telemetry values are extracted using regular expressions.



Examples:



```



/fps=\\s\*(\[0-9.]+)/

/speed=\\s\*(\[0-9.]+x)/

/size=\\s\*(\[0-9A-Za-z]+)/

/time=\\s\*(\[0-9:.]+)/



```



Extracted values update the UI in real time.



\---



\# Duration Extraction



FFmpeg prints total duration when input is opened:



```



Duration: 00:03:20



```



This value is parsed once per file.



Example regex:



```



/Duration:\\s\*(\[0-9:.]+)/



```



Duration is converted into seconds for progress calculation.



\---



\# Progress Calculation



Encoding progress is calculated using:



```



progress = current\_time / total\_duration



```



Example:



```



Video duration: 200 seconds

Current encoding time: 50 seconds



progress = 50 / 200 = 25%



```



The UI progress bar width is updated accordingly.



\---



\# Runtime Timer



The application tracks total encoding time using:



```



Date.now()



```



Runtime calculation:



```



elapsed\_time = current\_time - encodingStartTime



```



Converted into HH:MM:SS format.



\---



\# Cancellation System



The active FFmpeg process is stored globally:



```



currentFFmpegProcess



```



When the user presses cancel:



1\. Renderer sends IPC request

2\. Main process receives request

3\. FFmpeg process is terminated



Implementation:



```



currentFFmpegProcess.kill()



```



This prevents orphan background processes.



\---



\# Output File Naming



Encoded files use a structured naming convention.



Pattern:



```



originalfilename\_H265-CPU.mkv



```



Example:



```



movie.mov → movie\_H265-CPU.mkv



```



This ensures encoded files remain distinguishable from originals.



\---



\# State Management



Renderer maintains internal state variables:



```



videoFileList

currentFileIndex

totalFiles

finished

encodingStartTime

videoDurationSeconds



```



These variables control:



\- encoding progress

\- UI updates

\- completion detection



\---



\# Performance Considerations



Sequential encoding ensures predictable CPU utilization.



Parallel encoding was intentionally avoided due to:



\- CPU encoder saturation

\- memory contention

\- disk I/O bottlenecks



\---



\# Design Tradeoffs



The system prioritizes:



\- simplicity

\- reliability

\- deterministic behavior



over:



\- extreme performance optimization

\- complex multi-threaded encoding queues



This makes the system easier to maintain and extend.



\---



\# Potential Future Enhancements



The architecture allows future features without major refactoring.



Examples include:



\- GPU encoders (NVENC, QSV, AMF)

\- AV1 encoding

\- multiple encoding profiles

\- job queue management

\- batch presets

\- distributed encoding



These features can be integrated by extending the encoding pipeline and UI configuration system.



```





