'use strict';

// Remux-only consequence policy. These finite tags describe authorship, tools
// or capture dates; they do not define a decoder, timeline or access control.
// Copy them where supported, but do not reject intact media for their loss.
// Similar-looking, namespaced and newly encountered keys stay unassessed.
const DESCRIPTIVE_TAGS = Object.freeze([
  'vendor_id', 'encoder', 'generator', 'encoded_by', 'encoding_tool', 'software',
  'writing_application', 'muxing_application',
  'creation_time', 'source_creation_time', 'creation_date', 'capture_date', 'recording_date', 'date', 'date-eng', 'year',
  'comment', 'comments', 'author', 'artist', 'album_artist', 'composer',
  'copyright', 'publisher', 'album', 'genre',
]);
const DERIVED_TAGS = Object.freeze(['duration', 'number_of_frames', 'number_of_bytes']);
const FUNCTIONAL_TAGS = Object.freeze([
  'language', 'filename', 'mimetype', 'handler_name', 'rotate', 'rotation', 'orientation', 'timecode',
  'stereo_mode', 'projection_type', 'spherical', 'alpha_mode', 'color_range', 'color_space',
  'color_transfer', 'color_primaries', 'chroma_location', 'mastering_display_metadata', 'content_light_level',
  'replaygain_track_gain', 'replaygain_album_gain', 'replaygain_track_peak', 'replaygain_album_peak',
  'r128_track_gain', 'r128_album_gain', 'encoder_delay', 'encoder_padding', 'initial_padding', 'trailing_padding', 'itunsmpb',
]);
const descriptive = new Set(DESCRIPTIVE_TAGS), functional = new Set(FUNCTIONAL_TAGS), derived = new Set(DERIVED_TAGS);
const REMUX_METADATA_POLICY = Object.freeze({
  id: 'remux-functional-consequence', version: 1,
  descriptive: 'Attempt copy; missing or changed known descriptive metadata produces a structured warning.',
  functional: 'Preserve playback, quality, timing, interpretation, chapter navigation and attachment identity in the declared representation.',
  unassessed: 'Preserve exactly until a specific consequence assessment establishes another rule.',
  replacements: 'Only separately declared provenance, container identity and derived-counter transformations are allowed.',
  additions: 'Only descriptive/derived tags or exact main-declared neutral representations may be introduced; functional and unassessed output-only tags are refused.',
  descriptiveTagKeys: DESCRIPTIVE_TAGS, functionalTagKeys: FUNCTIONAL_TAGS, derivedTagKeys: DERIVED_TAGS,
});

function metadataScope(options) {
  const descriptor = options && typeof options === 'object' && Object.getOwnPropertyDescriptor(options, 'scope');
  if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
      || Reflect.ownKeys(options).length !== 1 || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
      || !['container', 'stream', 'chapter'].includes(descriptor.value)) throw new TypeError('An explicit supported Remux metadata scope is required.');
  return descriptor.value;
}

function classifyRemuxMetadataTag(key, options) {
  const scope = metadataScope(options);
  if (typeof key !== 'string' || !key.length || key.length > 256 || key.includes('\0')) throw new TypeError('A bounded exact metadata key is required.');
  const normalizedKey = key.toLowerCase();
  const label = normalizedKey === 'title' || normalizedKey === 'name';
  const containerDescription = scope === 'container' && ['description', 'synopsis'].includes(normalizedKey);
  const classification = derived.has(normalizedKey) ? 'operation-derived' : label ? scope === 'container' ? 'descriptive' : 'functional'
    : functional.has(normalizedKey) ? 'functional' : descriptive.has(normalizedKey) || containerDescription ? 'descriptive' : 'unassessed';
  const reason = classification === 'operation-derived' ? 'Muxer-derived duration/frame/byte tags describe the new container; actual content, counts and timing validate independently.'
    : label ? scope === 'container'
    ? 'A container label describes the file; it does not select or interpret a media track or chapter.'
    : 'Track and chapter labels identify content for selection or navigation.'
    : classification === 'descriptive' ? 'Known tool, authorship, editorial or capture-date description; no playback or quality consequence is asserted.'
    : classification === 'functional' ? 'The field can affect playback, quality, timing, track interpretation or attachment identity.'
    : 'No safe nonfunctional classification exists for this exact key; retain it as potentially functional.';
  return Object.freeze({ key, normalizedKey, scope, classification,
    preservation: classification === 'operation-derived' ? 'container-derived' : classification === 'descriptive' ? 'attempt-copy' : 'required',
    mismatch: classification === 'operation-derived' ? 'replacement' : classification === 'descriptive' ? 'warning' : 'error', reason });
}

// Header-semantic collectors use exactly the same policy as expected metadata.
// This projects tags only; it cannot waive a codec/header payload, attachment
// byte count, content hash, native per-frame metadata or any timing evidence.
function projectRequiredRemuxTags(tags, options) {
  const scope = metadataScope(options);
  if (!tags || typeof tags !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(tags))) {
    throw new TypeError('Remux metadata tags must be a plain data object.');
  }
  const projected = {};
  let characters = 0;
  for (const key of Reflect.ownKeys(tags)) {
    const descriptor = Object.getOwnPropertyDescriptor(tags, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Remux metadata tags must contain only enumerable scalar data.');
    const value = descriptor.value;
    if (!(value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))) {
      throw new TypeError('Remux metadata values must be finite scalar data.');
    }
    const text = String(value);
    characters += key.length + text.length;
    if (text.length > 16384 || text.includes('\0') || characters > 1048576) throw new TypeError('Remux metadata exceeds its text bound.');
    const classification = classifyRemuxMetadataTag(key, { scope });
    if (classification.preservation === 'required') Object.defineProperty(projected, key,
      { value: text, enumerable: true, writable: false, configurable: false });
  }
  return Object.freeze(projected);
}

module.exports = { REMUX_METADATA_POLICY, classifyRemuxMetadataTag, projectRequiredRemuxTags };
