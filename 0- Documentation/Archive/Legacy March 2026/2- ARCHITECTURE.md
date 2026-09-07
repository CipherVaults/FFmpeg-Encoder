\# Architecture



This document describes the internal architecture of the \*\*FFmpeg Batch Encoder UI\*\* application.



The goal of this document is to provide a clear understanding of how the system is structured, how components communicate, and how the encoding pipeline operates.



This documentation is intended for developers who want to:



\- understand how the application works

\- modify or extend the encoder

\- integrate additional features such as hardware encoders or new codecs





\---



\# System Overview



The application is built using \*\*Electron\*\*, which allows desktop applications to be built using web technologies.



Electron applications consist of two primary processes:



```



Renderer Process (UI Layer)

│

│ IPC Communication

▼

Main Process (System Layer)

│

│ Child Process

▼

FFmpeg Encoder



```



Each layer has a specific responsibility within the system.





\---



\# High-Level Architecture



```



+-----------------------------+

|        User Interface       |

|        (Renderer)           |

|                             |

|  - Folder selection         |

|  - Encoding monitor         |

|  - Progress visualization   |

+-------------+---------------+

|

| IPC Messages

|

+-------------v---------------+

|        Electron Main        |

|        Process              |

|                             |

|  - Launch FFmpeg            |

|  - Manage encoding process  |

|  - Handle cancellation      |

|  - System dialogs           |

+-------------+---------------+

|

|

v

+-----------------------------+

|          FFmpeg             |

|                             |

|  - Video encoding           |

|  - Telemetry output         |

|  - Compression algorithms   |

+-----------------------------+



```



\---



\# Renderer Process



File:



```



renderer.js



```



The renderer process contains all \*\*UI logic\*\* and user interaction.



It is responsible for:



\- scanning input directories

\- building encoding jobs

\- controlling the encoding pipeline

\- displaying real-time telemetry

\- updating progress bars and statistics



The renderer \*\*does not launch FFmpeg directly\*\*.



Instead, it communicates with the main process using Electron's \*\*IPC (Inter-Process Communication)\*\* system.



\---



\# Main Process



File:



```



main.js



```



The main process acts as the \*\*system controller\*\*.



Responsibilities include:



\- spawning FFmpeg processes

\- managing process lifecycle

\- handling system dialogs

\- exposing system capabilities to the renderer

\- terminating FFmpeg processes when cancellation occurs



The main process is the only component that interacts directly with the operating system.



\---



\# IPC Communication



Renderer and main processes communicate using \*\*Electron IPC channels\*\*.



Example flow:



```



Renderer → Main → FFmpeg



```



Example request:



```



ipcRenderer.invoke("encode-video")



```



Main process handler:



```



ipcMain.handle("encode-video", ...)



```



This separation prevents the UI layer from directly executing system-level operations.



\---



\# Encoding Pipeline



The encoding pipeline operates sequentially.



The steps are:



```



1\. User selects input folder

2\. Renderer scans folder for supported video files

3\. Files are sorted alphabetically

4\. Encoding pipeline begins

5\. Each file is processed one at a time

6\. Renderer requests encoding via IPC

7\. Main process launches FFmpeg

8\. FFmpeg outputs telemetry

9\. Renderer parses telemetry and updates UI

10\. Encoding completes and next file begins



```



\---



\# Sequential Encoding Engine



The encoder uses a sequential loop:



```



for (let i = 0; i < videoFileList.length; i++)



```



Each file waits for the previous encoding process to finish.



This ensures:



\- stable CPU usage

\- predictable system performance

\- no concurrent FFmpeg processes



This design is particularly important when using \*\*CPU-based encoders\*\*.



\---



\# Child Process Execution



FFmpeg is launched using Node.js:



```



child\_process.spawn()



```



Example:



```



spawn("./ffmpeg/ffmpeg.exe", args)



```



Advantages of using `spawn()` instead of `exec()`:



\- supports long-running processes

\- streams output in real time

\- avoids memory buffering limitations



\---



\# Telemetry Streaming



FFmpeg writes encoding progress to \*\*stderr\*\*.



Example output:



```



frame=  423 fps=23

size=1234kB time=00:00:17.32

speed=0.82x



```



The main process streams this output back to the renderer through IPC.



The renderer parses these messages to update the UI.



\---



\# Telemetry Parsing



The renderer extracts values using \*\*regular expressions\*\*.



Example patterns:



```



time=

fps=

speed=

size=

Duration:



```



Example extraction:



```



message.match(/fps=\\s\*(\[0-9.]+)/)



```



Parsed values are then displayed in the monitoring interface.



\---



\# Progress Calculation



The progress bar uses \*\*real encoding progress\*\*.



FFmpeg provides two important values:



```



Duration: 00:03:20

time=00:00:45



```



Progress percentage is calculated as:



```



progress = current\_time / total\_duration



```



Example:



```



45 seconds / 200 seconds = 22.5%



```



This value is applied directly to the progress bar.



\---



\# Runtime Timer



A runtime timer tracks total encoding duration.



This is calculated using:



```



Date.now() - encodingStartTime



```



The result is converted into a standard time format:



```



HH:MM:SS



```



\---



\# Cancellation System



The system allows encoding to be cancelled safely.



Workflow:



```



User presses Cancel

↓

Renderer sends IPC message

↓

Main process receives request

↓

Main process terminates FFmpeg process



```



Implementation:



```



currentFFmpegProcess.kill()



```



This ensures FFmpeg does not continue running in the background.



\---



\# File Detection System



Input folders are scanned using Node.js filesystem APIs.



```



fs.readdirSync()



```



Files are filtered by extension:



```



.mp4

.mkv

.mov

.avi

.webm



```



Files are then sorted alphabetically to ensure deterministic encoding order.



\---



\# Output Naming System



Encoded files use a structured naming convention.



Pattern:



```



originalname\_H265-CPU.mkv



```



Example:



```



clip.mov → clip\_H265-CPU.mkv



```



This makes it easy to distinguish encoded files from originals.



\---



\# Application State Management



The renderer tracks encoding state using internal variables:



```



currentFileIndex

totalFiles

finished

encodingStartTime

videoDurationSeconds



```



These values control:



\- UI updates

\- progress tracking

\- completion detection



\---



\# Error Handling



Basic error handling includes:



\- empty input folder detection

\- FFmpeg process exit code verification

\- cancellation safety



Future improvements may include:



\- failed file recovery

\- detailed error reporting

\- retry mechanisms



\---



\# Performance Considerations



The encoder intentionally avoids parallel processing.



Reasons:



\- CPU encoders already use all available cores

\- running multiple FFmpeg instances can reduce efficiency

\- sequential processing ensures predictable performance



\---



\# Design Philosophy



The architecture prioritizes:



\- clarity

\- stability

\- deterministic behavior

\- maintainability



Rather than maximizing feature count.



The goal is to provide a \*\*clean foundation for further development\*\*.



\---



\# Future Architectural Extensions



Potential improvements include:



\- GPU encoder integration

\- encoding queue management

\- multi-profile encoding

\- job persistence

\- distributed encoding support

\- plugin-based encoder configuration



These can be implemented without major architectural changes due to the current separation between UI, system control, and encoding logic.



```





