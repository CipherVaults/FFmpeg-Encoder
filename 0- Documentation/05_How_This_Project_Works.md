# How this project works

This guide explains the project for a reader who did not participate in its development. The architecture and product workflow below are implemented and verified through milestone H. The portable package remains the next step; Current State and the execution reports distinguish completed checks from remaining acceptance.

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

1. Choose separate input and output folders. The app scans supported top-level video files and presents a deterministic preview.
2. Review the effective profile, output names, and any exclusions or conflicts. Existing outputs will be skipped. Two input stems that produce the same destination need an explicit selection.
3. Main probes a selected video and checks whether its media/color information is supported. This milestone accepts supported SDR; it does not tone-map or preserve HDR video as a product feature.
4. FFmpeg encodes one video at a time. Supported audio/subtitle streams, attachments, chapters, and metadata are preserved according to the explicit mapping policy.
5. Progress records update the display. If duration is unknown, the app reports activity without inventing a precise percentage or finish time.
6. The app verifies the completed temporary output and publishes it without replacing another file. The final result comes from process completion and validation, not simply a full progress bar.
7. Results show successful, failed, skipped, cancelled, and unprocessed files. A subsequent batch becomes available when all child activity and cleanup have settled.

An output such as `clip_H265-CPU.mkv` describes the selected encoder family. Changing quality does not change that suffix, so choose another output folder when intentionally making a second variant. Original files are preserved.

## Color and cancellation

Ten-bit video can be SDR. HDR detection uses explicit transfer/metadata signals and bounded sampling, not bit depth or a codec label. If color evidence is incomplete or contradictory, the app explains that it cannot safely classify the input under the supported policy. Sampling has limits; the Technical Reference explains exactly what was inspected.

Cancel stops the active operation and prevents the next file from starting. Closing during encoding offers either cancelling and exiting or keeping the application open. There is no hidden encoding session after exit in this milestone.

## How to return after a long pause

Read Current State first, then the newest Session Summary. The execution index points to the literal work and test evidence. Architecture explains responsibilities; Technical Reference explains important media/process rules; the approved plan preserves acceptance criteria. Git records the exact file changes at recoverable checkpoints. None of these replaces the others: a green test needs relevant coverage, and a thoughtful document still needs a working implementation.
