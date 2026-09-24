# How this project works

## Current0.6 workflow additions

Expert profile/preset/CRF or CQ controls remain directly visible. Tested Default resets those ordinary controls; Archive Quality is a separate inspectable HEVC recipe. Hover or keyboard-focus the information controls, or expand Current encoding recipe. Prepared files expose the main-owned resolved argument array in their details. Before encoding, only the eventual protected temporary output path remains a clearly labelled placeholder.

Remembered folders/settings restore locally after validation. A compact filtered preview keeps selection independent of which rows are shown. Generated outputs are excluded by default; explicitly choose Re-encode this output when another lossy generation is intentional. Treat as original instead corrects an ambiguous legacy filename classification. Neither permission persists into a new preparation. This short project explanation covers the local0.6 workflow; it is not a new final end-user manual.


This guide explains the project for a reader who did not participate in its development. The architecture, product workflow and portable package are implemented and verified through the local 0.6 runtime; the September24 M report records acceptance disposition. Current State and execution reports record the tested scope and remaining future work.

## The application and its engine

FFmpeg is the program that reads, decodes, and encodes media. The Electron application supplies a window that helps Ahmed choose folders and encoding settings, see what will happen, and understand the results. Electron runs web-based interface code in a renderer process and operating-system work in its main process.

The original project grew through code copied from ChatGPT into Visual Studio Code. That history matters: the files and documents record both working features and ideas that were never fully connected. For example, the old settings controls could display a selected codec or quality while the actual command remained H.265 CPU at CRF 25. The re-entry treats source code and observed behavior as evidence and keeps the old documentation as history.

## Why the boundary changes

A renderer should be able to request “prepare this batch,” not “run any program with these arguments.” A small preload script bridges the interface and main process. Main validates the request, owns the selected folders and file list, and chooses an approved encoder command. This makes it easier to understand which part of the application is responsible and limits the damage of an interface bug.

The UI sends requests and displays snapshots. Main owns the queue and knows whether a file is being probed, encoded, cancelled, verified, or published. A child process is the running FFmpeg/ffprobe program. Its handle is kept until it actually exits; merely requesting cancellation does not mean the process is gone. This prevents cancellation from accidentally starting another file or losing track of a process.

## What an encoding profile means

H.264, H.265, and AV1 are video formats. An encoder is an implementation that produces one of those formats. CPU implementations use the processor; NVIDIA implementations use supported GPU encoding hardware. A preset is an encoder-specific speed/compression choice. CRF and CQ are encoder-specific quality controls. Similar numbers across encoders are not a promise of similar quality.

The app checks the actual shipped encoder and a short real encode before advertising a profile as working. If the GPU or driver cannot run a profile, the UI explains why that choice is unavailable. The program must not quietly substitute another profile and leave the user believing their original selection was used.

## A batch from beginning to end

1. Choose input and output folders; they may coincide on verified local fixed NTFS. The app scans supported top-level video files and presents a deterministic preview.
2. Review the effective profile, output names, and any exclusions or conflicts. Existing outputs will be skipped. Two input stems that produce the same destination need an explicit selection.
3. Main probes a selected video and checks whether its media/color information is supported. This milestone accepts supported SDR; it does not tone-map or preserve HDR video as a product feature.
4. FFmpeg encodes one video at a time. Supported audio/subtitle streams, attachments, chapters, and metadata are preserved according to the explicit mapping policy.
5. Progress records update the display. If duration is unknown, the app reports activity without inventing a precise percentage or finish time.
6. MP4 stream timestamps are represented as exact SOURCE_CREATION_TIME track tags with a preview notice. The app verifies the completed temporary output and publishes it without replacing another file. The final result comes from process completion and validation, not simply a full progress bar.
7. Results show successful, failed, skipped, cancelled, and unprocessed files. A subsequent batch becomes available when all child activity and cleanup have settled.

An output such as `clip_H265-CPU.mkv` describes the selected encoder family. Changing quality does not change that suffix, so choose another output folder when intentionally making a second variant. Original files are preserved.

## Color and cancellation

Ten-bit video can be SDR. HDR detection uses explicit transfer/metadata signals and bounded sampling, not bit depth or a codec label. If color evidence is incomplete or contradictory, the app explains that it cannot safely classify the input under the supported policy. Sampling has limits; the Technical Reference explains exactly what was inspected.

Cancel stops the active operation and prevents the next file from starting. Closing during encoding offers either cancelling and exiting or keeping the application open. There is no hidden encoding session after exit in this milestone.

## How to return after a long pause

Read Current State first, then the newest Session Summary. The execution index points to the literal work and test evidence. Architecture explains responsibilities; Technical Reference explains important media/process rules; the approved plan preserves acceptance criteria. Git records the exact file changes at recoverable checkpoints. None of these replaces the others: a green test needs relevant coverage, and a thoughtful document still needs a working implementation.

## Running the portable application

Extract the entire Windows ZIP into a writable folder and open FFmpeg Encoder.exe. Keep all extracted files together. Electron supplies the desktop runtime and the package supplies FFmpeg/ffprobe; a separate Node or FFmpeg installation is unnecessary. Compatible NVIDIA hardware and drivers are still needed for NVIDIA profiles. The application checks availability on startup.

The adjacent data folder holds application/session data and batch logs. Completed videos go to the output folder you choose. Wait for cancellation or encoding to finish before moving the application or removing its drive. The local package was tested on the development computer; that is different from acceptance on an independent clean computer.
