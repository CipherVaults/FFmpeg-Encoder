'use strict';
// Fixed 1440p developer service proof, never an application catalog grant.
const { runServiceCampaign } = require('./workbench-long-range-smoke.cjs');
const main = () => runServiceCampaign('fullResize1440to720');
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
