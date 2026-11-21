const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

const path = require('node:path');

// Only the media child receives this copy. The current caller still owns
// executable identity and argv admission; matching the tool name grants neither.
function mediaToolEnvironment(executable) {
  if (typeof executable !== 'string') return undefined;
  const windows = process.platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  if (!paths.isAbsolute(executable)) return undefined;
  const leaf = paths.basename(executable);
  const isMediaTool = windows ? /^ff(?:mpeg|probe)\.exe$/i.test(leaf) : leaf === 'ffmpeg' || leaf === 'ffprobe';
  if (!isMediaTool) return undefined;

  // FFmpeg and FFprobe can create an out-of-band report from FFREPORT, even
  // when app-owned arguments did not request it. Keep all other inherited keys.
  const overrides = Object.keys(process.env).filter(key => (windows ? key.toUpperCase() : key) === 'FFREPORT');
  if (!overrides.length) return undefined;
  const env = { ...process.env };
  for (const key of overrides) delete env[key];
  return env;
}

class ToolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    Object.assign(this, details);
  }
}

// Bound the UTF-8 representation by bytes, not JavaScript UTF-16 code units.
// When the beginning was discarded, drop continuation bytes rather than
// inventing a replacement character for a code point cut by our own limit.
function utf8Tail(value, limit, previouslyTruncated = false) {
  let bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  let truncated = previouslyTruncated || bytes.length > limit;
  if (bytes.length > limit) bytes = bytes.subarray(bytes.length - limit);
  if (truncated) {
    let start = 0;
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
    bytes = bytes.subarray(start);
  }
  let text = bytes.toString('utf8');
  // Invalid input bytes become U+FFFD during decoding and can expand. The
  // retained display text must still obey the byte limit in that case.
  if (Buffer.byteLength(text, 'utf8') > limit) {
    bytes = Buffer.from(text, 'utf8').subarray(-limit);
    let start = 0;
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
    text = bytes.subarray(start).toString('utf8');
    truncated = true;
  }
  return { text, truncated };
}

// Wrappers may impose a smaller local bound. Preserve the upstream byte count
// and lost-prefix flag; a legacy error without capture metadata stays unknown.
function boundedToolStderr(source, limit = 256 * 1024) {
  const tail = utf8Tail(typeof source?.stderr === 'string' ? source.stderr : '', limit);
  const upstream = source?.stderrCapture;
  const known = upstream && Number.isSafeInteger(upstream.totalBytes) && upstream.totalBytes >= 0
    && typeof upstream.truncated === 'boolean';
  const truncated = tail.truncated || source?.stderrTruncated === true || (known && upstream.truncated);
  return { stderr: tail.text, stderrTruncated: Boolean(truncated),
    ...(known ? { stderrCapture: { totalBytes: upstream.totalBytes, truncated: Boolean(truncated) } } : {}) };
}

// FFmpeg's progress channel is a record protocol, independent of stderr logs.
// A read can end anywhere, including halfway through a key or numeric value.
class ProgressParser {
  constructor(onRecord) {
    this.onRecord = onRecord;
    this.decoder = new StringDecoder('utf8');
    this.pending = '';
    this.record = {};
  }

  push(chunk) {
    this.pending += this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (this.pending.length > 65536) throw new ToolError('PROGRESS_LIMIT', 'Encoder progress record exceeded its limit.');
    let newline;
    while ((newline = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, newline).trim();
      this.pending = this.pending.slice(newline + 1);
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator);
      if (!/^[a-z0-9_]+$/i.test(key)) continue;
      this.record[key] = line.slice(separator + 1);
      if (key === 'progress') {
        const number = (value) => value !== undefined && value !== 'N/A' && Number.isFinite(Number(value)) ? Number(value) : null;
        const micros = number(this.record.out_time_us);
        this.onRecord({
          seconds: micros === null ? null : Math.max(0, micros / 1000000),
          fps: number(this.record.fps),
          speed: number(this.record.speed?.replace(/x$/, '')),
          bytes: number(this.record.total_size),
          frame: number(this.record.frame),
          ended: this.record.progress === 'end',
        });
        this.record = {};
      }
    }
  }
}

// Resolves only after 'close' and any asynchronous binary consumer has drained.
// Abort/error/timeout request termination but never release ownership early.
// The queue can therefore safely await this promise before starting a new job.
function runTool(executable, args, options = {}) {
  const {
    signal, timeoutMs = 30000, stdoutLimit = 16 * 1024 * 1024,
    stderrLimit = 256 * 1024, onProgress, onStdoutChunk, onOutputBytes, spawnImpl = spawn, onChild, input,
  } = options;
  const streaming = typeof onStdoutChunk === 'function';
  // FD3 is an explicit main-built output endpoint. Reuse the existing owned
  // binary callback with a pipe number, so runtime option admission stays exact.
  // Old callers have three stdio slots and receive the same single argument.
  const auxiliary = Array.isArray(args) && args.includes('pipe:3'), auxLimit = stdoutLimit;
  const beforeSpawnError = (code, message) => Promise.reject(new ToolError(code, message, {
    stderr: '', stderrCapture: { totalBytes: 0, truncated: false },
    ...(streaming ? { stdoutCapture: { totalBytes: 0, truncated: false, streamed: true } } : {}),
  }));
  if (signal?.aborted) return beforeSpawnError('CANCELLED', 'Operation cancelled.');
  if ((onStdoutChunk !== undefined && !streaming) || (streaming && onProgress !== undefined)) {
    return beforeSpawnError('INVALID_OUTPUT_MODE', 'Binary stdout streaming requires a function and cannot also parse progress.');
  }
  if (auxiliary && !streaming) return beforeSpawnError('INVALID_OUTPUT_MODE', 'An auxiliary binary pipe requires streamed stdout.');
  if (!Number.isSafeInteger(stdoutLimit) || stdoutLimit < 0) {
    return beforeSpawnError('INVALID_LIMIT', 'Tool stdout limit must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(stderrLimit) || stderrLimit < 0) {
    return beforeSpawnError('INVALID_LIMIT', 'Tool stderr limit must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(Date.now() + timeoutMs)) {
    return beforeSpawnError('INVALID_LIMIT', 'Tool timeout must be non-negative and exactly representable.');
  }
  if (input !== undefined && typeof input !== 'string' && !Buffer.isBuffer(input)) {
    return beforeSpawnError('INVALID_INPUT', 'Tool input must be text or bytes.');
  }
  if (input !== undefined && Buffer.byteLength(input) > 65536) {
    return beforeSpawnError('INPUT_LIMIT', 'Tool input exceeded its 64 KiB limit.');
  }
  return new Promise((resolve, reject) => {
    let child;
    let failure;
    let closed = false;
    let settled = false;
    let closeCode;
    let closeSignal;
    let stdout = '';
    let stderrTail = Buffer.alloc(0);
    let stderrBytes = 0;
    let outputBytes = 0;
    let deliveredBytes = 0;
    let auxBytes = 0, auxDelivered = 0;
    let pendingSinks = 0;
    let sinkTail = Promise.resolve();
    let timeout;
    let retryKill;
    const decoder = streaming ? null : new StringDecoder('utf8');
    const parser = onProgress ? new ProgressParser(onProgress) : null;

    const settle = () => {
      if (settled || !closed || pendingSinks !== 0) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(retryKill);
      signal?.removeEventListener('abort', abort);
      if (!parser && !streaming) stdout += decoder.end();
      const tail = utf8Tail(stderrTail, stderrLimit, stderrBytes > stderrLimit);
      const stderr = tail.text;
      const stderrCapture = { totalBytes: stderrBytes, truncated: tail.truncated };
      // This count describes pipe bytes, not merely successful callback bytes.
      // A failing/limited sink must never look like complete evidence capture.
      const capture = streaming ? { stdoutCapture: {
        totalBytes: outputBytes, truncated: outputBytes !== deliveredBytes, streamed: true,
      } } : {};
      if (auxiliary) capture.auxCapture = { totalBytes: auxBytes, truncated: auxBytes !== auxDelivered, streamed: true };
      if (failure) {
        Object.assign(failure, { stderr, stderrCapture, exitCode: closeCode, exitSignal: closeSignal, ...capture });
        reject(failure);
      } else if (closeCode !== 0) {
        reject(new ToolError('TOOL_FAILED', `Media tool exited with code ${closeCode}.`, {
          exitCode: closeCode, exitSignal: closeSignal, stderr, stderrCapture, ...capture,
        }));
      } else resolve({ stdout, stderr, stderrCapture, exitCode: closeCode, ...capture });
    };

    const stop = (error) => {
      if (settled) return;
      failure ||= error;
      // A sink can reject after process close. Retain its failure while still
      // waiting for other pending callbacks; do not misreport a zero exit as success.
      if (closed) return;
      // Windows kill() terminates only this owned process, never a process name
      // or a machine-wide process tree. Incomplete media stays in our temp path.
      try { child?.kill(); } catch { /* close remains the ownership boundary */ }
      if (!retryKill) retryKill = setTimeout(() => {
        if (!closed) { try { child?.kill('SIGKILL'); } catch { /* await close */ } }
      }, 2000);
      retryKill.unref();
      // Once the consumer has drained, discard further output while draining
      // the terminated child's pipe. Leaving a real Readable paused can prevent close.
      if (streaming && pendingSinks === 0) {
        try { child?.stdout?.resume?.(); } catch { /* owned child is already stopping */ }
        try { child?.stdio?.[3]?.resume?.(); } catch { /* owned child is already stopping */ }
      }
    };
    const abort = () => stop(new ToolError('CANCELLED', 'Operation cancelled.'));
    try {
      const stdio = [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']; if (auxiliary) stdio.push('pipe');
      const spawnOptions = { windowsHide: true, shell: false, stdio };
      const env = mediaToolEnvironment(executable);
      if (env) spawnOptions.env = env;
      child = spawnImpl(executable, args, spawnOptions);
    } catch (error) {
      reject(new ToolError('SPAWN_FAILED', `Could not launch the bundled media tool: ${error.message}`, {
        cause: error, stderr: '', stderrCapture: { totalBytes: 0, truncated: false },
        ...(streaming ? { stdoutCapture: { totalBytes: 0, truncated: false, streamed: true } } : {}),
      }));
      return;
    }
    child.on('error', error => {
      stop(new ToolError('SPAWN_FAILED', `Media tool process error: ${error.message}`, { cause: error }));
    });
    // A helper may close stdin early or a captured pipe may fail. These are
    // owned-process failures: terminate, then retain ownership through close.
    for (const stream of [child.stdin, child.stdout, child.stderr, ...(auxiliary ? [child.stdio?.[3]] : [])]) {
      stream?.on('error', error => stop(new ToolError('PIPE_FAILED', 'Media tool pipe failed.', { cause: error })));
    }
    child.stdout.on('data', chunk => {
      try {
        const bytes = Buffer.byteLength(chunk);
        outputBytes += bytes;
        onOutputBytes?.({ stream: 'stdout', bytes });
        if (parser) {
          // Preserve ordinary long-running progress behavior. Qualified jobs
          // explicitly opt into total pipe accounting and its per-child bound.
          if (onOutputBytes && outputBytes > stdoutLimit) stop(new ToolError('OUTPUT_LIMIT', 'Encoder progress exceeded its explicit byte limit.'));
          else if (!failure) parser.push(chunk);
        }
        else {
          if (failure) return;
          if (outputBytes > stdoutLimit) stop(new ToolError('OUTPUT_LIMIT', 'Media inspection exceeded its output limit.'));
          else if (streaming) {
            // Pause normal readable flow, not just a Promise queue. Node's exit
            // drainage can still deliver a buffered pipe chunk; byte limits and
            // serialized sink completion continue to cover that final delivery.
            child.stdout.pause();
            const bytes = Buffer.from(chunk);
            pendingSinks++;
            sinkTail = sinkTail.then(async () => {
              try {
                if (!failure) { await onStdoutChunk(bytes); deliveredBytes += bytes.length; }
              } catch (error) {
                stop(new ToolError('STDOUT_SINK_FAILED', 'Binary output consumer failed.', { cause: error }));
              } finally {
                pendingSinks--;
                if (pendingSinks === 0 && !closed) {
                  try { child.stdout.resume(); if (auxiliary) child.stdio[3].resume(); }
                  catch (error) { stop(new ToolError('PIPE_FAILED', 'Could not resume binary output.', { cause: error })); }
                }
                settle();
              }
            });
          }
          else stdout += decoder.write(chunk);
        }
      } catch (error) { stop(error); }
    });
    if (auxiliary) {
      const pipe = child.stdio?.[3];
      if (!pipe || typeof pipe.pause !== 'function' || typeof pipe.resume !== 'function') {
        stop(new ToolError('PIPE_FAILED', 'Auxiliary output requires an owned backpressure-capable pipe.'));
      } else pipe.on('data', chunk => {
        try {
          auxBytes += Buffer.byteLength(chunk);
          // Aggregate accounting uses the existing stderr bucket, while actual
          // diagnostic capture remains separate and strict. No old caller has
          // this pipe; its argv, stdio shape and captures remain byte-identical.
          onOutputBytes?.({ stream: 'stderr', bytes: Buffer.byteLength(chunk) });
          if (auxBytes > auxLimit) { stop(new ToolError('OUTPUT_LIMIT', 'Auxiliary media output exceeded its byte limit.')); return; }
          if (failure) return;
          pipe.pause(); const bytes = Buffer.from(chunk); pendingSinks++;
          sinkTail = sinkTail.then(async () => {
            try { if (!failure) { await onStdoutChunk(bytes, 3); auxDelivered += bytes.length; } }
            catch (error) { stop(new ToolError('STDOUT_SINK_FAILED', 'Auxiliary output consumer failed.', { cause: error })); }
            finally {
              pendingSinks--;
              if (pendingSinks === 0 && !closed) {
                try { child.stdout.resume(); pipe.resume(); } catch (error) { stop(new ToolError('PIPE_FAILED', 'Could not resume owned output.', { cause: error })); }
              }
              settle();
            }
          });
        } catch (error) { stop(error); }
      });
    }
    child.stderr.on('data', chunk => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += bytes.length;
      try { onOutputBytes?.({ stream: 'stderr', bytes: bytes.length }); }
      catch (error) { stop(error); }
      // Keep raw bytes until close so arbitrary pipe chunk boundaries never
      // split a multi-byte character. Copy the retained tail to avoid keeping a
      // reference to a discarded, potentially much larger backing allocation.
      if (bytes.length >= stderrLimit) stderrTail = Buffer.from(bytes.subarray(bytes.length - stderrLimit));
      else {
        const keep = Math.min(stderrTail.length, stderrLimit - bytes.length);
        stderrTail = Buffer.concat([stderrTail.subarray(stderrTail.length - keep), bytes], keep + bytes.length);
      }
    });
    child.once('close', (exitCode, exitSignal) => {
      closed = true;
      closeCode = exitCode;
      closeSignal = exitSignal;
      clearTimeout(retryKill);
      settle();
    });
    if (streaming && (typeof child.stdout.pause !== 'function' || typeof child.stdout.resume !== 'function')) {
      stop(new ToolError('PIPE_FAILED', 'Binary output requires a backpressure-capable pipe.'));
    }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    if (timeoutMs > 0) {
      // A proportional long-stream budget can exceed Node's signed-32-bit
      // timer delay. Schedule it in slices rather than accidentally timing out
      // after 1ms. Existing finite short deadlines retain the same behavior.
      const deadline = Date.now() + timeoutMs;
      const arm = () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) { stop(new ToolError('TIMEOUT', 'Media operation exceeded its time limit.')); return; }
        timeout = setTimeout(arm, Math.min(remaining, 2147483647)); timeout.unref();
      };
      arm();
    }
    try { onChild?.(child); }
    catch (error) { stop(new ToolError('SPAWN_FAILED', 'Media tool ownership callback failed.', { cause: error })); }
    if (input !== undefined && !signal?.aborted && !failure && !closed) {
      try { child.stdin.end(input); }
      catch (error) { stop(new ToolError('PIPE_FAILED', 'Could not send bounded tool input.', { cause: error })); }
    }
  });
}

// Infrastructure failures stop every inspection worker; malformed media and
// bounded decode timeouts remain per-file evidence failures.
function isSharedToolFailure(error) {
  return ['SPAWN_FAILED', 'PIPE_FAILED', 'ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'OUTPUT_FOLDER_CHANGED'].includes(error.code)
    || /no space left|disk full|cannot load.*nv|driver does not support|no capable devices/i.test(error.stderr || '');
}
module.exports = { ToolError, ProgressParser, runTool, isSharedToolFailure, boundedToolStderr };
