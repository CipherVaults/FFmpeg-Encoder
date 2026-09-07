# HOW_THIS_PROJECT_WORKS_FOR_BEGINNERS

## What this project is

This project is a desktop app built with **Electron** that helps encode videos in batches using **FFmpeg**.

In simple terms:

- The app gives you a graphical interface instead of making you type long FFmpeg commands by hand.
- You choose files or folders and start the process from the app.
- The app runs FFmpeg behind the scenes.
- The app shows real progress, real telemetry, and the current state of the encoding work.

So this project is **not** a custom video encoder.
It is a **desktop controller and interface** for FFmpeg.

---

## Why this project exists

FFmpeg is powerful, but it can feel difficult and unfriendly if you only use it from the command line.

This project exists to make that workflow easier by providing:

- a desktop UI
- batch processing
- queue control
- real progress display
- clearer feedback while encoding is running

The goal is to keep FFmpeg as the real engine, while the app handles the human-friendly side.

---

## The three main files

The current project structure is intentionally simple:

- `main.js`
- `renderer.js`
- `index.html` (with embedded CSS)

### `index.html`
This is the visible page of the app.
It defines what the user sees.

It contains things like:

- buttons
- labels
- progress areas
- input sections
- monitor sections
- layout and styling

Because the CSS is embedded, the visual styling lives inside this same HTML file instead of being stored in a separate `style.css` file.

### `renderer.js`
This is the part that controls the app from the UI side.

It is responsible for things like:

- reacting to button clicks
- reading values from the interface
- managing queue state
- controlling the overall encoding flow
- updating the screen with telemetry and progress

A simple way to think about it:

> `renderer.js` is the app's control room for the user-facing side.

### `main.js`
This is the Electron main process file.

It is responsible for things the UI should not do directly, such as:

- creating the application window
- handling OS-level operations
- launching FFmpeg
- communicating execution results back to the renderer

A simple way to think about it:

> `main.js` is the app's system-level worker.

---

## Important programming ideas explained simply

## What is a variable?
A **variable** is a named place where a program stores information.

Examples of what a variable might store in this project:

- the current file being encoded
- total number of files
- current progress value
- whether encoding is running
- a folder path

You can think of a variable like a labeled box.
The label tells you what is inside.

Example idea:

```js
let currentFileIndex = 0;
```

This means:

- create a variable named `currentFileIndex`
- store the number `0` in it

---

## What is a function?
A **function** is a reusable block of instructions.

Instead of rewriting the same logic again and again, you put that logic inside a function and call it when needed.

In this project, a function might:

- start encoding
- update the UI
- calculate progress
- move to the next file in the queue
- parse FFmpeg output

You can think of a function like a tool with a name.
When you use its name, it does its job.

Example idea:

```js
function updateProgress(value) {
  // update the progress bar
}
```

---

## What is a loop?
A **loop** is a way to repeat something.

In many programs, loops are used when you want to process a list of items.

In this project, the queue logic is conceptually related to looping because the app needs to handle multiple files one after another.

That does **not** necessarily mean the app uses one giant raw loop in the simplest form. It may instead move through the queue step by step. But the core idea is the same:

- take one file
- process it
- move to the next file
- continue until finished

That is the practical meaning of a repeated workflow.

---

## What is an event listener?
An **event listener** waits for something to happen.

Examples:

- a button is clicked
- a message arrives from another process
- FFmpeg sends new output

In this project, event listeners are very important because the app reacts to actions and incoming updates.

Examples of what listeners might do:

- start encoding when the user clicks a button
- receive telemetry from the main process
- update the progress bar when new progress data arrives

You can think of an event listener like a guard standing by a door, waiting for a signal.

---

## What is the renderer?
In Electron, the **renderer** is the part connected to the page the user sees.

This project's renderer:

- manages the visible app flow
- controls queue behavior
- updates the UI
- reacts to progress and telemetry

This is why `renderer.js` is so important: it is where most of the user-facing logic lives.

---

## What is the main process?
In Electron, the **main process** is the part that controls the application itself at the desktop/system level.

This project's main process:

- opens the app window
- handles OS-related actions
- launches FFmpeg as a real system process

This keeps the responsibilities clear:

- renderer = interface and flow control
- main = execution and OS-level work

---

## What is IPC?
**IPC** means **Inter-Process Communication**.

That sounds complex, but the idea is simple.

The renderer and main process are separate parts of the app, so they need a way to talk to each other.
That communication is IPC.

In this project, IPC is used when:

- the renderer asks the main process to do something
- the main process sends results or updates back

Example idea:

- user clicks **Start**
- renderer says: “main process, please launch FFmpeg for this file”
- main process runs FFmpeg
- main process sends telemetry back
- renderer updates the screen

IPC is basically the message bridge between the two halves of the app.

---

## What is a child process?
A **child process** is a program launched by another program.

In this project:

- the Electron app is the parent
- FFmpeg is launched as a child process

Why is that useful?
Because FFmpeg already knows how to encode video.
The app does not need to rebuild FFmpeg from scratch.
It just starts FFmpeg, passes arguments to it, and listens to its output.

This is one of the most important ideas in the whole project.

---

## What are FFmpeg arguments?
When FFmpeg is launched, it needs instructions.
Those instructions are called **arguments**.

Arguments tell FFmpeg things like:

- which input file to use
- which output file to create
- which video codec to use
- what quality settings to use
- how audio should be handled

You can think of FFmpeg arguments as the recipe given to the encoder.

A simplified example idea might look like this:

```bash
ffmpeg -i input.mp4 -c:v libx265 -preset slow -crf 25 -c:a copy output.mp4
```

That kind of command says, roughly:

- use `input.mp4` as the source
- encode video with `libx265`
- use the `slow` preset
- use quality level `25`
- copy the audio without re-encoding it
- save the result as `output.mp4`

The Electron app builds and sends this kind of instruction to FFmpeg.

---

## How the project works step by step

Here is the full project flow in beginner-friendly language.

## Step 1: The app opens
When the app starts:

- `main.js` creates the Electron window
- `index.html` is loaded
- `renderer.js` becomes active in the UI side

At this point, the user sees the interface.

---

## Step 2: The user interacts with the UI
The user clicks buttons, selects paths, or chooses settings.

The renderer listens for these actions.

Examples:

- choose input folder
- choose output folder
- start encoding
- cancel encoding

The renderer reads the user's choices and stores the needed state.

---

## Step 3: The renderer prepares the queue
The renderer is responsible for queue orchestration.

That means it decides:

- which files are waiting
- which file is current
- when the next file should begin
- when the whole batch is finished

This is a very important distinction:

- the renderer controls the batch flow
- the main process performs the execution work

---

## Step 4: The renderer sends a request to the main process
Once a file is ready to encode, the renderer uses IPC to send a request to the main process.

That request contains the information needed to run FFmpeg.

For example, it may include:

- input path
- output path
- selected encoding settings

---

## Step 5: The main process launches FFmpeg
The main process receives the request and starts FFmpeg as a child process.

This is where the real encoding begins.

FFmpeg is now doing the heavy work.
The Electron app is not encoding the video itself.
It is managing and observing the process.

---

## Step 6: FFmpeg produces telemetry
While FFmpeg runs, it prints live information.
This information is called **telemetry**.

Telemetry may include things like:

- current encoded time
- processing speed
- frames per second
- output size
- runtime-related details

The main process reads this output.

---

## Step 7: Real progress is calculated and displayed
The project now uses **real FFmpeg-driven progress**.
There is no mock progress remaining.

This means the app is not pretending that progress is happening.
It is reading real FFmpeg output and updating the UI based on actual encoding state.

So when the progress bar moves, it reflects real work.

The renderer receives telemetry updates and updates:

- the progress bar
- textual progress information
- current status sections
- live monitoring UI

---

## Step 8: Cancellation can happen
If the user cancels, the renderer triggers the cancellation flow.
The main process then stops the active FFmpeg process.

This means cancellation is not just visual.
It affects the real encoding process.

After that, the renderer can update the UI and control what happens next.

---

## Step 9: The renderer moves to the next file
If encoding finishes normally, the renderer decides what to do next.

Because the renderer orchestrates the queue, it can:

- mark the current file as done
- move to the next file
- continue until the queue is complete

This is why the renderer is best understood as the flow controller of the app.

---

## Step 10: The batch completes
When all files are done:

- the renderer marks the queue as finished
- the UI reflects completion
- the session can end or be reset for a new run

---

## Why the project is split this way
This architecture is useful because it keeps responsibilities clean.

### Renderer responsibilities
The renderer handles:

- user interaction
- queue orchestration
- screen updates
- state management
- flow control

### Main process responsibilities
The main process handles:

- system-level tasks
- Electron window setup
- FFmpeg execution
- OS-level operations

### FFmpeg responsibilities
FFmpeg handles:

- actual video/audio encoding
- media processing
- runtime telemetry generation

This separation makes the app easier to reason about and safer to improve later.

---

## Why FFmpeg is not reimplemented
A beginner might ask:

> Why not just build the encoder directly inside JavaScript?

Because FFmpeg already solves the hard problem.

Video encoding is complicated, mature, and performance-heavy.
It makes far more sense to let FFmpeg do the encoding and let the Electron app act as:

- a controller
- a UI
- a queue manager
- a progress monitor

That is one of the smartest design choices in this project.

---

## A simple mental model
If all of this still feels abstract, use this mental model:

- **index.html** = the face of the app
- **renderer.js** = the coordinator
- **main.js** = the worker manager
- **FFmpeg** = the actual machine doing the encoding
- **IPC** = the messaging bridge between coordinator and worker manager

And the flow is:

1. user clicks a button
2. renderer reacts
3. renderer sends a request to main
4. main launches FFmpeg
5. FFmpeg reports progress
6. main forwards updates
7. renderer updates the UI
8. renderer continues the queue until done

---

## What a beginner should understand first
If you are new to programming, these are the most important truths to keep in mind:

1. This app is mainly about **control flow**, not inventing a new encoder.
2. The renderer is where the app's visible behavior is coordinated.
3. The main process is where real execution work is launched.
4. FFmpeg is the external engine that does the heavy technical work.
5. IPC is the bridge that lets those parts communicate.
6. The queue is controlled in the renderer.
7. Progress is real and based on FFmpeg telemetry.

If you understand those seven points, you already understand the heart of the project.

---

## Final beginner summary
This project is a desktop Electron app that helps a user batch-encode videos through FFmpeg.

Its current architecture is simple and clear:

- `index.html` shows the interface
- `renderer.js` controls the queue and UI flow
- `main.js` launches FFmpeg and handles OS-level work
- FFmpeg does the real encoding
- progress comes from real FFmpeg telemetry

That is the core of how the whole system works.
