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
  if (signal?.aborted) return Promise.reject(new ToolError('CANCELLED', 'Operation cancelled.'));
  if (input !== undefined && typeof input !== 'string' && !Buffer.isBuffer(input)) {
    return Promise.reject(new ToolError('INVALID_INPUT', 'Tool input must be text or bytes.'));
  }
  if (input !== undefined && Buffer.byteLength(input) > 65536) {
    return Promise.reject(new ToolError('INPUT_LIMIT', 'Tool input exceeded its 64 KiB limit.'));
  }
  return new Promise((resolve, reject) => {
    let child;
    let failure;
    let closed = false;
    let stdout = '';
    let stderr = '';
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
      reject(new ToolError('SPAWN_FAILED', `Could not launch the bundled media tool: ${error.message}`, { cause: error }));
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
      stderr = (stderr + chunk.toString()).slice(-stderrLimit);
    });
    child.once('close', (exitCode, exitSignal) => {
      closed = true;
      clearTimeout(timeout);
      clearTimeout(retryKill);
      signal?.removeEventListener('abort', abort);
      if (!parser) stdout += decoder.end();
      if (failure) {
        failure.stderr = stderr;
        failure.exitCode = exitCode;
        reject(failure);
      } else if (exitCode !== 0) {
        reject(new ToolError('TOOL_FAILED', `Media tool exited with code ${exitCode}.`, { exitCode, exitSignal, stderr }));
      } else resolve({ stdout, stderr, exitCode });
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

module.exports = { ToolError, ProgressParser, runTool };
