'use strict';

// Unblinded recipes stay in the separate key. These companions expose only
// scene/label identities, playback order and blank human-review fields.
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const quote = value => `"${String(value).replaceAll('"', '""')}"`;

function companions(groups) {
  const files = groups.map(group => ({ name: `scene-${group.id}.m3u`,
    text: '#EXTM3U\n' + group.entries.map(entry =>
      `#EXTINF:-1,${group.title} - ${entry.label}\n${entry.clip}`).join('\n') + '\n' }));
  files.push({ name: 'feedback.csv', text: 'scene,label,close_to_x265,texture,motion,text_gradients,preference,notes\n'
    + groups.flatMap(group => group.entries.filter(entry => entry.label.startsWith('Candidate'))
      .map(entry => [group.id, entry.label, '', '', '', '', '', ''].map(quote).join(','))).join('\n') + '\n' });
  const scenes = groups.map(group => `<tr><td>${escape(group.title)}</td><td>${escape(group.context)}</td>
    <td><a href="scene-${escape(group.id)}.m3u">Motion playlist</a></td><td>${group.entries.length} clips</td></tr>`).join('\n');
  files.push({ name: 'review-guide.html', text: `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Calibration review guide</title>
<style>body{font:17px system-ui,sans-serif;line-height:1.5;max-width:1050px;margin:32px auto;padding:0 18px;color:#17212b;background:white}
a{color:#006bb3}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #bdcbd6;text-align:left}.note{background:#eef5fb;padding:14px}a:focus-visible{outline:3px solid #eb8523}</style>
<h1>Your calibration review</h1><p class="note">This is a preference decision before held-out testing. The captured source and accepted x265 reference are named. Candidate labels are randomized separately for each scene; Candidate A in one scene is unrelated to Candidate A elsewhere.</p>
<p><a href="index.html">Open matched stills</a> · <a href="feedback.csv">Blank feedback CSV</a></p>
<ol><li>Start with Crimson Desert, Expedition 33 and Forza. Compare source → x265 → candidates at 100% image size. Use the same matched frame and scroll position. Fit view helps navigation but scales pixels.</li>
<li>Check motion in your existing MPC-HC. Open a scene playlist with File → Open File, then use its playlist to switch between labeled clips. The files are 12 seconds, video-only, native resolution and presentation timing. Compare foliage, surface texture, particles and dark detail; stills alone can miss shimmer or temporal damage.</li>
<li>For each candidate, record whether it is close enough to x265 for your archive: yes, borderline or no. Note any texture/motion issue that matters to you. Desktop text and gradients and native1440 ACC are separate cohorts.</li>
<li>Only after writing your visual preferences, consult the separate reveal-key.json if you want settings. The next decision combines your judgment with measured size and speed. No label alone wins a finalist slot, and no application default changes.</li></ol>
<p>You can reply in plain text: scene, preferred candidate label(s), rejected labels and the visible reason. To use CSV, save a copy as my-feedback.csv before editing; the original is a hashed evidence file. “Borderline” and “none close enough” are useful answers. An initial pass should take about20–30minutes; revisit only the decisive differences.</p>
<table><thead><tr><th>Scene</th><th>Inspect</th><th>Motion</th><th>Material</th></tr></thead><tbody>${scenes}</tbody></table>
<p>These captures were already AV1-compressed. The FFV1 source clips preserve their decoded pixels; they are not lossless game-render ground truth. RGB PNGs use the same BT.709 limited-to-full conversion without resizing. Judge final color/motion in the video clips.</p>
<p>Browser/Windows scaling and player settings can change physical pixel mapping. Keep the same player and display conditions. Codec properties can reveal identities, so this is a partially blinded comparison, not a formal double-blind experiment. No held-out footage is included.</p></html>` });
  return files;
}

module.exports = { companions };
