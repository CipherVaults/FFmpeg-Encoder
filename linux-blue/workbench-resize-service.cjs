'use strict';
// Main-only developer proof, not an application route. An unfinished campaign
// cannot create a service, construct its runtime or reserve evidence storage.
const path = require('node:path');
const { createProportionalServiceFactory } = require('./workbench-long-range-service.cjs');
const REPORT = path.join(__dirname, 'artifacts', 'resize-calibration-RQsj84', 'report.json');
const REPORT_SHA = 'dd0637354ea1ca27e57c75958074423aff98f37ab6da00a3459a6dac2b206c32';
const composition = createProportionalServiceFactory({ kind: 'resize1080to720', report: REPORT, reportSha: REPORT_SHA });
const createResizeService = composition.createService, assertResizeReceipt = composition.assertReceipt;
module.exports = { createResizeService, assertResizeReceipt, REPORT, REPORT_SHA };
