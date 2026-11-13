'use strict';

// Reviewed local qualification, not encoder discovery or renderer authority.
// Evidence: artifacts/v0.7/slice2/continuation2-2026-10-23/catalog-evidence-v2.json
// and, for the NVIDIA cell re-measured on driver 621.14 (record 47, Q2a),
// artifacts/v0.7/milestone-q/q2a/catalog-evidence-v3-nvidia-621.14.json
// (SHA256 91cd933c82437553dd8046bc5a61511ebb167fa43918414b1cbcdb1dbdf52a90).
// The 621.01 cell stays: its evidence still describes that driver.
// The two whole-file copied-audio cells (record 47, Q2b) come from
// artifacts/v0.7/milestone-q/q2b/catalog-evidence-v4-full-copy-r2.json
// (SHA256 48fb030eef87f19cd616e0044c73bc9c3da40b6d3060ba1ba69a2c25b5ad2811).
// CPU A/B use a transparent retained-output clock correction; all other cells
// have current compact-collector endpoints. Per-job source/runtime/storage and
// full decoded validation remain mandatory; no wider hardware/media claim.
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const FAMILIES = freeze([
  {
    "id": "short-sdr-range-v1",
    "evidenceIds": [
      "sdr-range-20261023:h265-cpu:b794beab835636c7:endpoints",
      "sdr-range-20261023:h265-cpu:b794beab835636c7:interior",
      "sdr-range-20261023:h265-cpu:b794beab835636c7:A",
      "sdr-range-20261023:h265-cpu:b794beab835636c7:B",
      "sdr-range-20261023:h265-cpu:b794beab835636c7:C",
      "sdr-range-20261023:h265-cpu:b794beab835636c7:D",
      "sdr-range-20261023:h265-cpu:b794beab835636c7:D-keep",
      "sdr-range-20261023:h265-cpu:b794beab835636c7:E"
    ],
    "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
    "environment": null,
    "settings": {
      "profileId": "h265-cpu",
      "preset": "slow",
      "quality": 25
    },
    "qualification": {
      "evidenceId": "sdr-range-20261023:h265-cpu:b794beab835636c7:endpoints",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "containerDuration": "matroska-packet-end-plus-codec-delay",
      "tolerances": {
        "videoTimestampUs": 1067,
        "audioTimestampUs": 22355,
        "avSyncUs": 23422,
        "durationUs": 1088,
        "sampleCount": 1023
      }
    },
    "timingQualification": {
      "evidenceId": "sdr-range-20261023:h265-cpu:b794beab835636c7:interior",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "videoDurationUs": 1067,
      "audioTimelineUs": 1042,
      "aac": {
        "alignment": "decoded-after-signalled-skip",
        "encoderDelaySamples": 1024,
        "discardPaddingSamples": 0
      }
    },
    "budget": {
      "sourceDecode": "complete",
      "timeoutMs": 120000,
      "maxFrameBytes": 8388608,
      "maxPcmBytes": 134217728,
      "maxRecords": 20000,
      "maxSpoolBytes": 33554432
    },
    "executionBudgetMs": 600000
  },
  {
    "id": "short-sdr-range-v1",
    "evidenceIds": [
      "sdr-range-20261023:h265-nvidia:b794beab835636c7:endpoints",
      "sdr-range-20261023:h265-nvidia:b794beab835636c7:interior",
      "sdr-range-20261023:h265-nvidia:b794beab835636c7:A",
      "sdr-range-20261023:h265-nvidia:b794beab835636c7:B",
      "sdr-range-20261023:h265-nvidia:b794beab835636c7:C",
      "sdr-range-20261023:h265-nvidia:b794beab835636c7:D",
      "sdr-range-20261023:h265-nvidia:b794beab835636c7:D-keep",
      "sdr-range-20261023:h265-nvidia:b794beab835636c7:E"
    ],
    "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
    "environment": {
      "adapterIdentity": "GPU-7c34153a-b267-4a86-1398-c6026d0b98b2",
      "driverVersion": "621.01",
      "runtimeVersion": "FFmpeg9.0.2:56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6"
    },
    "settings": {
      "profileId": "h265-nvidia",
      "preset": "p5",
      "quality": 25
    },
    "qualification": {
      "evidenceId": "sdr-range-20261023:h265-nvidia:b794beab835636c7:endpoints",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "containerDuration": "matroska-packet-end-plus-codec-delay",
      "tolerances": {
        "videoTimestampUs": 1067,
        "audioTimestampUs": 22355,
        "avSyncUs": 23422,
        "durationUs": 1088,
        "sampleCount": 1023
      }
    },
    "timingQualification": {
      "evidenceId": "sdr-range-20261023:h265-nvidia:b794beab835636c7:interior",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "videoDurationUs": 1067,
      "audioTimelineUs": 1042,
      "aac": {
        "alignment": "decoded-after-signalled-skip",
        "encoderDelaySamples": 1024,
        "discardPaddingSamples": 0
      }
    },
    "budget": {
      "sourceDecode": "complete",
      "timeoutMs": 120000,
      "maxFrameBytes": 8388608,
      "maxPcmBytes": 134217728,
      "maxRecords": 20000,
      "maxSpoolBytes": 33554432
    },
    "executionBudgetMs": 600000
  },
  {
    "id": "short-sdr-range-v1",
    "evidenceIds": [
      "sdr-range-20261112:h265-nvidia:91cd933c82437553:endpoints",
      "sdr-range-20261112:h265-nvidia:91cd933c82437553:interior",
      "sdr-range-20261112:h265-nvidia:91cd933c82437553:A",
      "sdr-range-20261112:h265-nvidia:91cd933c82437553:B",
      "sdr-range-20261112:h265-nvidia:91cd933c82437553:C",
      "sdr-range-20261112:h265-nvidia:91cd933c82437553:D",
      "sdr-range-20261112:h265-nvidia:91cd933c82437553:D-keep",
      "sdr-range-20261112:h265-nvidia:91cd933c82437553:E"
    ],
    "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
    "environment": {
      "adapterIdentity": "GPU-7c34153a-b267-4a86-1398-c6026d0b98b2",
      "driverVersion": "621.14",
      "runtimeVersion": "FFmpeg9.0.2:56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6"
    },
    "settings": {
      "profileId": "h265-nvidia",
      "preset": "p5",
      "quality": 25
    },
    "qualification": {
      "evidenceId": "sdr-range-20261112:h265-nvidia:91cd933c82437553:endpoints",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "containerDuration": "matroska-packet-end-plus-codec-delay",
      "tolerances": {
        "videoTimestampUs": 1067,
        "audioTimestampUs": 22355,
        "avSyncUs": 23422,
        "durationUs": 1088,
        "sampleCount": 1023
      }
    },
    "timingQualification": {
      "evidenceId": "sdr-range-20261112:h265-nvidia:91cd933c82437553:interior",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "videoDurationUs": 1067,
      "audioTimelineUs": 1042,
      "aac": {
        "alignment": "decoded-after-signalled-skip",
        "encoderDelaySamples": 1024,
        "discardPaddingSamples": 0
      }
    },
    "budget": {
      "sourceDecode": "complete",
      "timeoutMs": 120000,
      "maxFrameBytes": 8388608,
      "maxPcmBytes": 134217728,
      "maxRecords": 20000,
      "maxSpoolBytes": 33554432
    },
    "executionBudgetMs": 600000
  },
  {
    "id": "full-sdr-resize-copy-v1",
    "evidenceIds": [
      "full-copy-20261112:h265-cpu:48fb030eef87f19c:endpoints",
      "full-copy-20261112:h265-cpu:48fb030eef87f19c:interior",
      "full-copy-20261112:h265-cpu:48fb030eef87f19c:A",
      "full-copy-20261112:h265-cpu:48fb030eef87f19c:E"
    ],
    "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
    "environment": null,
    "settings": {
      "profileId": "h265-cpu",
      "preset": "slow",
      "quality": 25
    },
    "qualification": {
      "evidenceId": "full-copy-20261112:h265-cpu:48fb030eef87f19c:endpoints",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "containerDuration": "matroska-copy-end-plus-codec-delay",
      "tolerances": {
        "videoTimestampUs": 1067,
        "audioTimestampUs": 1042,
        "avSyncUs": 2109,
        "durationUs": 1088,
        "sampleCount": 0
      }
    },
    "timingQualification": {
      "evidenceId": "full-copy-20261112:h265-cpu:48fb030eef87f19c:interior",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "videoDurationUs": 1067,
      "audioTimelineUs": 1042,
      "aac": null
    },
    "budget": {
      "sourceDecode": "complete",
      "timeoutMs": 120000,
      "maxFrameBytes": 8388608,
      "maxPcmBytes": 134217728,
      "maxRecords": 20000,
      "maxSpoolBytes": 33554432
    },
    "executionBudgetMs": 600000
  },
  {
    "id": "full-sdr-resize-copy-v1",
    "evidenceIds": [
      "full-copy-20261112:h265-nvidia:48fb030eef87f19c:endpoints",
      "full-copy-20261112:h265-nvidia:48fb030eef87f19c:interior",
      "full-copy-20261112:h265-nvidia:48fb030eef87f19c:A",
      "full-copy-20261112:h265-nvidia:48fb030eef87f19c:E"
    ],
    "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
    "environment": {
      "adapterIdentity": "GPU-7c34153a-b267-4a86-1398-c6026d0b98b2",
      "driverVersion": "621.14",
      "runtimeVersion": "FFmpeg9.0.2:56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6"
    },
    "settings": {
      "profileId": "h265-nvidia",
      "preset": "p5",
      "quality": 25
    },
    "qualification": {
      "evidenceId": "full-copy-20261112:h265-nvidia:48fb030eef87f19c:endpoints",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "containerDuration": "matroska-copy-end-plus-codec-delay",
      "tolerances": {
        "videoTimestampUs": 1067,
        "audioTimestampUs": 1042,
        "avSyncUs": 2109,
        "durationUs": 1088,
        "sampleCount": 0
      }
    },
    "timingQualification": {
      "evidenceId": "full-copy-20261112:h265-nvidia:48fb030eef87f19c:interior",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "videoDurationUs": 1067,
      "audioTimelineUs": 1042,
      "aac": null
    },
    "budget": {
      "sourceDecode": "complete",
      "timeoutMs": 120000,
      "maxFrameBytes": 8388608,
      "maxPcmBytes": 134217728,
      "maxRecords": 20000,
      "maxSpoolBytes": 33554432
    },
    "executionBudgetMs": 600000
  }
]);
const POLICY_ID = "sdr-range-v1:2026-11-12:b794beab835636c75048f52f8e82c8260e6c1c733179e18d6d028e99fb06c82c+91cd933c82437553dd8046bc5a61511ebb167fa43918414b1cbcdb1dbdf52a90+48fb030eef87f19cd616e0044c73bc9c3da40b6d3060ba1ba69a2c25b5ad2811";
module.exports = { FAMILIES, POLICY_ID };
