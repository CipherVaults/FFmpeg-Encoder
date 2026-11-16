'use strict';
// Distinct pre-catalog 1080p30→720p proof, reusing the strict streaming campaign.
// Importing it starts nothing; it creates neither service nor application route.
const { runCampaign } = require('./workbench-long-range-calibration.cjs');
const main = () => runCampaign('resize1080to720');
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
