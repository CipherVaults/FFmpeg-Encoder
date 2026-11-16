'use strict';
// Fixed main-owned Full developer composition. Pending evidence is not authority
// to instantiate a runtime, reserve storage, or activate an application route.
const path = require('node:path');
const { createProportionalServiceFactory } = require('./workbench-long-range-service.cjs');
const REPORT = path.join(__dirname, 'artifacts', 'full-resize-calibration-KKDQwg', 'report.json');
const REPORT_SHA = '197c1fc42a4108a9e5b2e4997588a828acd7c4c2aa8a7fe23772376e1535e871';
const composition = createProportionalServiceFactory({ kind: 'fullResize1080to720', report: REPORT, reportSha: REPORT_SHA });
const createFullResizeService = composition.createService, assertFullResizeReceipt = composition.assertReceipt;
module.exports = { createFullResizeService, assertFullResizeReceipt, REPORT, REPORT_SHA };
