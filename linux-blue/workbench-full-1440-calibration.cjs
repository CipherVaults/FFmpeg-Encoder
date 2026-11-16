'use strict';
// Separate 1440p Full source geometry, same 720p output and complete audio tails.
// No media starts on import and no application route is activated by this proof.
const { runCampaign } = require('./workbench-long-range-calibration.cjs');
const main = () => runCampaign('fullResize1440to720');
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
