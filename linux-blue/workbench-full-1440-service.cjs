'use strict';
// Fixed main-only 1440p Full developer variant, not an app catalog entry.
// Pending evidence cannot authorize runtime, storage, or service construction.
const path = require('node:path');
const { createProportionalServiceFactory } = require('./workbench-long-range-service.cjs');
const REPORT = path.join(__dirname, 'artifacts', 'full-1440-calibration-DXg0TU', 'report.json');
const REPORT_SHA = '7f31a166bb875695abaf0ea6f9917b969b07b2ac544db2624bf4c7cfd448dd65';
const composition = createProportionalServiceFactory({ kind: 'fullResize1440to720', report: REPORT, reportSha: REPORT_SHA });
const createFull1440Service = composition.createService, assertFull1440Receipt = composition.assertReceipt;
module.exports = { createFull1440Service, assertFull1440Receipt, REPORT, REPORT_SHA };
