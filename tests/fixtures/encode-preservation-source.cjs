'use strict';

// Inert unit-test observations, not an actual-media qualification fixture.
function source(indexes = [0, 1, 2]) {
  const [v, a, d] = indexes;
  const video = { index: v, id: '0x1', codec_type: 'video', codec_name: 'av1', profile: 'Main', pix_fmt: 'yuv420p',
    width: 1920, height: 1080, coded_width: 1920, coded_height: 1080, sample_aspect_ratio: '1:1', field_order: 'progressive',
    r_frame_rate: '60/1', avg_frame_rate: '60/1', color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv',
    time_base: '1/15360', start_pts: 0, duration_ts: 92160, tags: { timecode: '01:02:03:04' }, disposition: { default: 1 } };
  const audio = { index: a, id: '0x2', codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp',
    sample_rate: '48000', channels: 2, channel_layout: 'stereo', disposition: { default: 1 } };
  const timed = { index: d, id: '0x3', codec_type: 'data', codec_tag_string: 'tmcd', time_base: '1/15360',
    start_pts: 0, duration_ts: 92160, tags: { timecode: '01:02:03:04' }, disposition: { default: 1 } };
  return { streams: [video, audio, timed], chapters: [], programs: [],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '6', nb_streams: 3, nb_programs: 0, nb_stream_groups: 1 },
    stream_groups: [{ index: 0, id: '0x3', type: 'Track Reference', nb_streams: 2, components: [], streams: [video, timed] }] };
}
module.exports = { source };
