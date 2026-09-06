// =======================================================
// main.js
// Main Electron process for the FFmpeg Encoder application
//
// Responsibilities of this file:
// 1. Create the Electron application window
// 2. Launch the bundled FFmpeg binary for testing
// 3. Handle OS-level operations (like folder selection)
// 4. Communicate with the renderer process via IPC
// =======================================================

// Import required Electron modules
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

// Import Node.js module used to launch external programs
const { spawn } = require('child_process');

// Reference to the currently running FFmpeg process (used for cancellation)
let currentFFmpegProcess = null;


// =======================================================
// Function: createWindow()
// Creates the main application window and loads the UI
// =======================================================
function createWindow() {

  const win = new BrowserWindow({
    width: 1000,
    height: 700,

    // These settings allow the renderer process (UI)
    // to access Node.js APIs such as child_process.
    // For production apps this is usually restricted,
    // but for a local tool like this encoder it is acceptable.
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Load the HTML interface
  win.loadFile('index.html');
}


// =======================================================
// Function: testFFmpeg()
// Runs a quick FFmpeg command to verify that the bundled
// FFmpeg executable works correctly.
//
// This is only a development sanity check.
// Later this function may be removed.
// =======================================================
function testFFmpeg() {

  // Launch FFmpeg with "-version" argument
  const ffmpeg = spawn('./ffmpeg/ffmpeg.exe', ['-version']);

  // Capture normal output
  ffmpeg.stdout.on('data', (data) => {
    console.log(`FFmpeg Output: ${data}`);
  });

  // Capture error output
  ffmpeg.stderr.on('data', (data) => {
    console.error(`FFmpeg Error: ${data}`);
  });

  // Detect when the process exits
  ffmpeg.on('close', (code) => {
    console.log(`FFmpeg process exited with code ${code}`);
  });
}


// =======================================================
// IPC Handler: Folder Selection
//
// The renderer process (UI) cannot directly access
// OS dialogs. Instead it asks the main process to do it.
//
// Renderer → IPC request → main process opens dialog
// → selected folder path returned to renderer.
// =======================================================
ipcMain.handle('select-folder', async () => {

  // Open the native operating system folder picker
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  // If user cancels the dialog, return null
  if (result.canceled) {
    return null;
  }

  // Otherwise return the selected folder path
  return result.filePaths[0];
});


// =======================================================
// Application Startup
//
// This runs when Electron finishes initialization.
// We create the window and perform the FFmpeg test.
// =======================================================
app.whenReady().then(() => {

  createWindow();

  // Development check to ensure FFmpeg works
  testFFmpeg();

});

// =======================================================
// IPC: Run FFmpeg encode job
// This receives encoding instructions from renderer.js
// and runs FFmpeg in the Electron main process.
// =======================================================


ipcMain.handle("encode-video", async (event, inputFile, outputFile) => {

    return new Promise((resolve, reject) => {

        const ffmpegArgs = [

            "-i", inputFile,

            "-c:v", "libx265",
            "-preset", "slow",
            "-crf", "25",

            "-tag:v", "hvc1",
            "-x265-params", "aq-mode=3:psy-rd=2",

            "-c:a", "copy",

            outputFile

        ];

        // Start FFmpeg process and store reference globally
        currentFFmpegProcess = spawn("./ffmpeg/ffmpeg.exe", ffmpegArgs);

        currentFFmpegProcess.stderr.on("data", data => {

    const message = data.toString();

    console.log(`FFmpeg: ${message}`);

    // Send raw FFmpeg output to renderer
    event.sender.send("ffmpeg-output", message);

});

        // When FFmpeg finishes (or is cancelled)
        currentFFmpegProcess.on("close", code => {

            // Clear stored process reference so next encode works
            currentFFmpegProcess = null;

            if (code === 0) {
                resolve();
            } else {
                reject(new Error("FFmpeg exited with code " + code));
            }

        });

    });

});

// =======================================================
// IPC: Cancel current encoding
// This allows the renderer (UI) to stop FFmpeg
// =======================================================

ipcMain.handle("cancel-encoding", async () => {

    if (currentFFmpegProcess) {

        console.log("Cancelling FFmpeg process...");

        currentFFmpegProcess.kill();

        currentFFmpegProcess = null;

    }

});