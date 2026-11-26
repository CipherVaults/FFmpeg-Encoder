'use strict';

const { ToolError } = require('./process-runner.cjs');
const { assertWindowsSubtitleProbe } = require('./remux-windows-subrip.cjs');

const WINDOWS_TIMED_MATROSKA = 'h264-timed-matroska-windows-v1';
const SOURCE_ERROR = 'REMUX_CHAPTER_SOURCE_UNQUALIFIED';
const NATIVE_ERROR = 'REMUX_NATIVE_CHAPTER_COPY';
const requireChapter = (condition, message, code = SOURCE_ERROR) => {
  if (!condition) throw new ToolError(code, message);
};

function assertWindowsChapterProbe(probe) {
  requireChapter(probe.streams.length === 1 && probe.streams[0].index === 0
    && probe.streams[0].codec_type === 'video' && probe.streams[0].codec_name === 'h264'
    && probe.chapters.length === 2 && !probe.programs?.length && !probe.stream_groups?.length,
  'This Windows Matroska route requires one H.264 video track and two flat chapters.');
  let lastEnd = 0n;
  for (const [index, chapter] of probe.chapters.entries()) {
    requireChapter(String(chapter.id) === String(index + 1) && chapter.time_base === '1/1000000000'
      && [chapter.start, chapter.end].every(value => (typeof value === 'string' || Number.isSafeInteger(value))
        && /^(0|[1-9]\d{0,17})$/.test(String(value)))
      && typeof chapter.tags?.title === 'string' && chapter.tags.title.length > 0,
    'This Windows Matroska route needs two identified chapter titles and exact nonnegative chapter clocks.');
    const start = BigInt(chapter.start), end = BigInt(chapter.end);
    requireChapter(start >= lastEnd && end > start && start % 1000000n === 0n && end % 1000000n === 0n,
      'This Windows Matroska route needs two ordered, nonoverlapping chapter intervals on the measured millisecond grid.');
    lastEnd = end;
  }
}

async function readWindowsChapterDisplays({ meta, probe, integer, text }) {
  assertWindowsChapterProbe(probe);
  function only(parent, type) {
    const rows = parent.children.filter(node => node.type === type);
    requireChapter(rows.length === 1, 'The native chapter hierarchy or display is missing or ambiguous.', NATIVE_ERROR);
    return rows[0];
  }
  const sections = meta.nodes.filter(node => node.type === '0x1043a770');
  requireChapter(sections.length === 1 && sections[0].parent?.type === '0x18538067',
    'The file needs one native chapter section in its segment.', NATIVE_ERROR);
  const edition = only(sections[0], '0x45b9');
  const chapters = meta.nodes.filter(node => node.type === '0xb6');
  requireChapter(chapters.length === probe.chapters.length && chapters.every(node => node.parent === edition),
    'The file needs exactly two native chapters in one flat edition.', NATIVE_ERROR);
  const displays = [];
  for (const [index, atom] of chapters.entries()) {
    const chapter = probe.chapters[index];
    const id = String(await integer(only(atom, '0x73c4')));
    const start = String(await integer(only(atom, '0x91')));
    const end = String(await integer(only(atom, '0x92')));
    const display = only(atom, '0x80');
    const title = await text(only(display, '0x85'));
    const language = await text(only(display, '0x437c'));
    requireChapter(display.children.every(node => ['0x85', '0x437c'].includes(node.type)) && language === 'und'
      && id === String(chapter.id) && start === String(chapter.start) && end === String(chapter.end)
      && title === chapter.tags.title,
    'Native chapter identity, clocks, title and the single explicit und language must agree with the observed chapter.', NATIVE_ERROR);
    displays.push({ id, start, end, title, language });
  }
  return displays;
}

function assertWindowsTimedMatroskaProbe(probe) {
  if (probe.chapters.length || probe.streams.length === 1) {
    assertWindowsChapterProbe(probe);
    return 'chapters';
  }
  assertWindowsSubtitleProbe(probe);
  return 'subrip';
}

module.exports = { WINDOWS_TIMED_MATROSKA, assertWindowsTimedMatroskaProbe, readWindowsChapterDisplays };
