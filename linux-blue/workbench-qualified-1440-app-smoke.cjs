'use strict';
// Fixed four-family app-factory proof, not an application entry.
const { main: runComposedCampaign } = require('./workbench-qualified-app-smoke.cjs');
const main = () => runComposedCampaign('four1440');
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
