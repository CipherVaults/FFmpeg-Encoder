'use strict';
// Explicit developer proof of the independently calibrated downscale service.
const { runServiceCampaign } = require('./workbench-long-range-smoke.cjs');
const main = () => runServiceCampaign('resize1080to720');
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
