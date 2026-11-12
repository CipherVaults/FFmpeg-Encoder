'use strict';

// Compact per-file counts for the executor's required compatibility run.
module.exports = async function* (events) {
  const rows = new Map();
  for await (const { type, data } of events) {
    if (['test:pass', 'test:fail'].includes(type) && data.file && data.details?.type !== 'suite') {
      const row = rows.get(data.file) || { pass: 0, fail: 0, skip: 0 };
      row[data.skip ? 'skip' : type === 'test:pass' ? 'pass' : 'fail']++;
      rows.set(data.file, row);
      if (type === 'test:fail') yield `FAIL ${data.file}: ${data.name}\n${data.details?.error?.stack || data.details?.error}\n`;
    }
    if (type === 'test:summary' && !data.file) {
      for (const [file, counts] of rows) yield `${JSON.stringify({ file, ...counts })}\n`;
      yield `${JSON.stringify({ summary: data })}\n`;
    }
  }
};
