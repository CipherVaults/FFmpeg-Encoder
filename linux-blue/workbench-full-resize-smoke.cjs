'use strict';
// Genuine shared-service Full resize proof, separate from application activation.
const { runServiceCampaign } = require('./workbench-long-range-smoke.cjs');
const main = () => runServiceCampaign('fullResize1080to720');
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
