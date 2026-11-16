'use strict';
// Full-file proof preserves the whole source timeline, including a longer audio tail.
// Importing this developer entry starts no job and activates no application route.
const { runCampaign } = require('./workbench-long-range-calibration.cjs');
const main = () => runCampaign('fullResize1080to720');
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
