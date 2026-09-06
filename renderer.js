// =======================================================
// renderer.js
// UI logic for the FFmpeg Encoder application
// =======================================================

const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

document.addEventListener('DOMContentLoaded', () => {

let videoDurationSeconds = 0;

let latestFFmpegStats = {
    time: null,
    fps: null,
    speed: null,
    size: null
};

// ===================================================
// DOM REFERENCES
// ===================================================

const setupView = document.getElementById('setup-view');
const monitorView = document.getElementById('monitor-view');

const inputPath = document.getElementById('input-path');
const outputPath = document.getElementById('output-path');

const selectInputBtn = document.getElementById('select-input-btn');
const selectOutputBtn = document.getElementById('select-output-btn');
const startBtn = document.getElementById('start-encoding-btn');

const codecSelect = document.getElementById('codec');
const hardwareSelect = document.getElementById('hardware');
const presetSelect = document.getElementById('preset');

const crfSlider = document.getElementById('crf-slider');
const crfDisplay = document.getElementById('crf-display');

const monCodec = document.getElementById('mon-codec');
const monHardware = document.getElementById('mon-hardware');
const monPreset = document.getElementById('mon-preset');
const monCrf = document.getElementById('mon-crf');

const fileCounter = document.getElementById('file-counter');
const currentFileSpan = document.getElementById('current-file');

const progressFill = document.getElementById('progress-fill');

const encodedTime = document.getElementById('encoded-time');
const speedSpan = document.getElementById('speed');
const fpsSpan = document.getElementById('fps');
const outputSizeSpan = document.getElementById('output-size');
const totalEncodingTimeSpan = document.getElementById('total-encoding-time');

const cancelBtn = document.getElementById('cancel-encoding-btn');

const completedContainer = document.getElementById('completed-container');
const completedFiles = document.getElementById('completed-files');
const completedTime = document.getElementById('completed-time');

// ===================================================
// STATE
// ===================================================

let videoFileList = [];
let currentFileIndex = 1;
let totalFiles = 0;
let finished = false;
let encodingStartTime = null;

// ===================================================
// FFmpeg TELEMETRY
// ===================================================

ipcRenderer.on("ffmpeg-output", (event, message) => {

    const durationMatch = message.match(/Duration:\s*([0-9:.]+)/);
    if (durationMatch && videoDurationSeconds === 0) {

        const parts = durationMatch[1].split(':');

        videoDurationSeconds =
            parseInt(parts[0]) * 3600 +
            parseInt(parts[1]) * 60 +
            parseFloat(parts[2]);
    }

    const timeMatch = message.match(/time=\s*([0-9:.]+)/);

    if (timeMatch) {

        const cleanTime = timeMatch[1].split('.')[0];
        encodedTime.textContent = cleanTime;

        const parts = timeMatch[1].split(':');

        const currentSeconds =
            parseInt(parts[0]) * 3600 +
            parseInt(parts[1]) * 60 +
            parseFloat(parts[2]);

        if (videoDurationSeconds > 0) {

            const percent =
                Math.min(100, (currentSeconds / videoDurationSeconds) * 100);

            progressFill.style.width = percent + '%';
        }
    }

    const fpsMatch = message.match(/fps=\s*([0-9.]+)/);
    if (fpsMatch) fpsSpan.textContent = Math.round(fpsMatch[1]);

    const speedMatch = message.match(/speed=\s*([0-9.]+x)/);
    if (speedMatch) speedSpan.textContent = speedMatch[1];

    const sizeMatch = message.match(/size=\s*([0-9A-Za-z]+)/);
    if (sizeMatch) outputSizeSpan.textContent = sizeMatch[1];

});

// ===================================================
// HELPER
// ===================================================

function getVideoFiles(folderPath) {

    if (!folderPath) return [];

    try {

        const files = fs.readdirSync(folderPath);

        const supportedExtensions = [
            '.mp4',
            '.mkv',
            '.mov',
            '.avi',
            '.webm'
        ];

        return files
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return supportedExtensions.includes(ext);
            })
            .sort((a, b) => a.localeCompare(b));

    } catch (err) {

        console.error("Folder read failed:", err);
        return [];
    }
}

// ===================================================
// SETTINGS → MONITOR COPY
// ===================================================

function updateMonitorSettings() {

    monCodec.textContent = codecSelect.value;
    monHardware.textContent = hardwareSelect.value;
    monPreset.textContent = presetSelect.value;
    monCrf.textContent = crfSlider.value;

}

// ===================================================
// CRF SLIDER
// ===================================================

crfSlider.addEventListener('input', () => {
    crfDisplay.textContent = crfSlider.value;
});

// ===================================================
// INPUT FOLDER
// ===================================================

selectInputBtn.addEventListener('click', async () => {

    const folder = await ipcRenderer.invoke('select-folder');

    if (folder) inputPath.textContent = folder;

});

// ===================================================
// OUTPUT FOLDER
// ===================================================

selectOutputBtn.addEventListener('click', async () => {

    const folder = await ipcRenderer.invoke('select-folder');

    if (folder) outputPath.textContent = folder;

});

// ===================================================
// START ENCODING
// ===================================================

startBtn.addEventListener('click', async () => {

    const videoFiles = getVideoFiles(inputPath.textContent);

    videoFileList = videoFiles;
    totalFiles = videoFiles.length;

    if (totalFiles === 0) {

        alert("No supported video files found.");
        return;
    }

    startBtn.disabled = true;

    setupView.classList.add('hidden');
    monitorView.classList.remove('hidden');

    await new Promise(resolve => setTimeout(resolve, 100));

    currentFileIndex = 1;
    finished = false;
    encodingStartTime = Date.now();
    videoDurationSeconds = 0;

    progressFill.style.width = '0%';

    fileCounter.textContent = `File ${currentFileIndex} of ${totalFiles}`;
    currentFileSpan.textContent = videoFileList[0];

    encodedTime.textContent = '00:00:00';
    speedSpan.textContent = '0.00x';
    fpsSpan.textContent = '0';

    outputSizeSpan.textContent = '0 MB';
    totalEncodingTimeSpan.textContent = '00:00:00';

    completedContainer.style.display = 'none';

    cancelBtn.disabled = false;
    cancelBtn.textContent = '[ Cancel Encoding ]';

    updateMonitorSettings();

    const settings = {
    crf: crfSlider.value
};

    // runtime timer

    const runtimeTimer = setInterval(() => {

        if (finished) return;

        const totalElapsed =
            Math.floor((Date.now() - encodingStartTime) / 1000);

        const totalElapsedStr =
            new Date(totalElapsed * 1000)
            .toISOString()
            .substr(11, 8);

        totalEncodingTimeSpan.textContent = totalElapsedStr;

    }, 1000);

    // ===================================================
    // SEQUENTIAL ENCODING
    // ===================================================

    for (let i = 0; i < videoFileList.length; i++) {

        const videoName = videoFileList[i];

        const inputFilePath =
            path.join(inputPath.textContent, videoName);

        const parsed = path.parse(videoName);

        const outputFileName =
            parsed.name + "_H265-CPU.mkv";

        const outputFilePath =
            path.join(outputPath.textContent, outputFileName);

        await ipcRenderer.invoke("encode-video", inputFilePath, outputFilePath);

        currentFileIndex++;

        videoDurationSeconds = 0;

        if (currentFileIndex <= totalFiles) {

            fileCounter.textContent =
                `File ${currentFileIndex} of ${totalFiles}`;

            currentFileSpan.textContent =
                videoFileList[currentFileIndex - 1];

            progressFill.style.width = '0%';
        }

    }

    finished = true;

    clearInterval(runtimeTimer);

    completedContainer.style.display = 'block';
    completedFiles.textContent = totalFiles;
    completedTime.textContent = totalEncodingTimeSpan.textContent;

    cancelBtn.disabled = true;
    cancelBtn.textContent = '[ Encoding Finished ]';

    startBtn.disabled = false;

});

// ===================================================
// CANCEL ENCODING
// ===================================================

cancelBtn.addEventListener('click', async () => {

    if (finished) return;

    await ipcRenderer.invoke("cancel-encoding");

    monitorView.classList.add('hidden');
    setupView.classList.remove('hidden');

    finished = true;
    startBtn.disabled = false;

});

// ===================================================
// INITIAL CRF DISPLAY
// ===================================================

crfDisplay.textContent = crfSlider.value;

});