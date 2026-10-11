const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

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

// Resolves only after 'close', which means the child and its streams are gone.
// Abort/error/timeout request termination but never release ownership early.
// The queue can therefore safely await this promise before starting a new job.
function runTool(executable, args, options = {}) {
  const {
    signal, timeoutMs = 30000, stdoutLimit = 16 * 1024 * 1024,
    stderrLimit = 256 * 1024, onProgress, spawnImpl = spawn, onChild, input,
  } = options;
  const beforeSpawnError = (code, message) => Promise.reject(new ToolError(code, message, {
    stderr: '', stderrCapture: { totalBytes: 0, truncated: false },
  }));
  if (signal?.aborted) return beforeSpawnError('CANCELLED', 'Operation cancelled.');
  if (!Number.isSafeInteger(stderrLimit) || stderrLimit < 0) {
    return beforeSpawnError('INVALID_LIMIT', 'Tool stderr limit must be a non-negative integer.');
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
    let stdout = '';
    let stderrTail = Buffer.alloc(0);
    let stderrBytes = 0;
    let outputBytes = 0;
    let timeout;
    let retryKill;
    const decoder = new StringDecoder('utf8');
    const parser = onProgress ? new ProgressParser(onProgress) : null;

    const stop = (error) => {
      if (closed) return;
      failure ||= error;
      // Windows kill() terminates only this owned process, never a process name
      // or a machine-wide process tree. Incomplete media stays in our temp path.
      child?.kill();
      if (!retryKill) retryKill = setTimeout(() => { if (!closed) child?.kill('SIGKILL'); }, 2000);
      retryKill.unref();
    };
    const abort = () => stop(new ToolError('CANCELLED', 'Operation cancelled.'));
    try {
      child = spawnImpl(executable, args, { windowsHide: true, shell: false, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
      onChild?.(child);
    } catch (error) {
      reject(new ToolError('SPAWN_FAILED', `Could not launch the bundled media tool: ${error.message}`, {
        cause: error, stderr: '', stderrCapture: { totalBytes: 0, truncated: false },
      }));
      return;
    }
    child.on('error', error => {
      failure ||= new ToolError('SPAWN_FAILED', `Media tool process error: ${error.message}`, { cause: error });
    });
    // A helper may close stdin early or a captured pipe may fail. These are
    // owned-process failures: terminate, then retain ownership through close.
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream?.on('error', error => stop(new ToolError('PIPE_FAILED', 'Media tool pipe failed.', { cause: error })));
    }
    child.stdout.on('data', chunk => {
      try {
        if (parser) parser.push(chunk);
        else {
          outputBytes += Buffer.byteLength(chunk);
          if (outputBytes > stdoutLimit) stop(new ToolError('OUTPUT_LIMIT', 'Media inspection exceeded its output limit.'));
          else stdout += decoder.write(chunk);
        }
      } catch (error) { stop(error); }
    });
    child.stderr.on('data', chunk => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += bytes.length;
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
      clearTimeout(timeout);
      clearTimeout(retryKill);
      signal?.removeEventListener('abort', abort);
      if (!parser) stdout += decoder.end();
      const tail = utf8Tail(stderrTail, stderrLimit, stderrBytes > stderrLimit);
      const stderr = tail.text;
      const stderrCapture = { totalBytes: stderrBytes, truncated: tail.truncated };
      if (failure) {
        failure.stderr = stderr;
        failure.stderrCapture = stderrCapture;
        failure.exitCode = exitCode;
        reject(failure);
      } else if (exitCode !== 0) {
        reject(new ToolError('TOOL_FAILED', `Media tool exited with code ${exitCode}.`, { exitCode, exitSignal, stderr, stderrCapture }));
      } else resolve({ stdout, stderr, stderrCapture, exitCode });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    if (timeoutMs > 0) {
      timeout = setTimeout(() => stop(new ToolError('TIMEOUT', 'Media operation exceeded its time limit.')), timeoutMs);
      timeout.unref();
    }
    if (input !== undefined && !signal?.aborted) {
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
