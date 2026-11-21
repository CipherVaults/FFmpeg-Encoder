'use strict';

// Reviewed local qualification, not encoder discovery or renderer authority.
// Evidence: SDR range catalogue v2 (October 23, 2026).
// The NVIDIA cell re-measured on driver 621.14 uses catalogue v3 (record 47, Q2a)
// (SHA256 91cd933c82437553dd8046bc5a61511ebb167fa43918414b1cbcdb1dbdf52a90).
// The 621.01 cell stays: its evidence still describes that driver.
// The two whole-file copied-audio cells use catalogue v4 (record 47, Q2b)
// (SHA256 48fb030eef87f19cd616e0044c73bc9c3da40b6d3060ba1ba69a2c25b5ad2811).
// The two precision-FLAC range cells use catalogue v5 (record 47, Q2c)
// (SHA256 58e6c2aef6fdbf46ae59d490324af87ffb7c0be11bd4a81192e55ff9b7ab3d3c).
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
  },
  {
    "id": "short-sdr-range-flac-v1",
    "evidenceIds": [
      "flac-range-20261113:h265-cpu:58e6c2aef6fdbf46:endpoints",
      "flac-range-20261113:h265-cpu:58e6c2aef6fdbf46:interior",
      "flac-range-20261113:h265-cpu:58e6c2aef6fdbf46:A",
      "flac-range-20261113:h265-cpu:58e6c2aef6fdbf46:B",
      "flac-range-20261113:h265-cpu:58e6c2aef6fdbf46:C",
      "flac-range-20261113:h265-cpu:58e6c2aef6fdbf46:D",
      "flac-range-20261113:h265-cpu:58e6c2aef6fdbf46:E",
      "flac-range-20261113:h265-cpu:58e6c2aef6fdbf46:D-keep"
    ],
    "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
    "environment": null,
    "settings": {
      "profileId": "h265-cpu",
      "preset": "slow",
      "quality": 25
    },
    "qualification": {
      "evidenceId": "flac-range-20261113:h265-cpu:58e6c2aef6fdbf46:endpoints",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "containerDuration": "end-timestamp",
      "tolerances": {
        "videoTimestampUs": 1067,
        "audioTimestampUs": 1042,
        "avSyncUs": 2109,
        "durationUs": 1088,
        "sampleCount": 0
      }
    },
    "timingQualification": {
      "evidenceId": "flac-range-20261113:h265-cpu:58e6c2aef6fdbf46:interior",
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
    "id": "short-sdr-range-flac-v1",
    "evidenceIds": [
      "flac-range-20261113:h265-nvidia:58e6c2aef6fdbf46:endpoints",
      "flac-range-20261113:h265-nvidia:58e6c2aef6fdbf46:interior",
      "flac-range-20261113:h265-nvidia:58e6c2aef6fdbf46:A",
      "flac-range-20261113:h265-nvidia:58e6c2aef6fdbf46:B",
      "flac-range-20261113:h265-nvidia:58e6c2aef6fdbf46:C",
      "flac-range-20261113:h265-nvidia:58e6c2aef6fdbf46:D",
      "flac-range-20261113:h265-nvidia:58e6c2aef6fdbf46:E",
      "flac-range-20261113:h265-nvidia:58e6c2aef6fdbf46:D-keep"
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
      "evidenceId": "flac-range-20261113:h265-nvidia:58e6c2aef6fdbf46:endpoints",
      "runtimeIdentity": "56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6",
      "containerDuration": "end-timestamp",
      "tolerances": {
        "videoTimestampUs": 1067,
        "audioTimestampUs": 1042,
        "avSyncUs": 2109,
        "durationUs": 1088,
        "sampleCount": 0
      }
    },
    "timingQualification": {
      "evidenceId": "flac-range-20261113:h265-nvidia:58e6c2aef6fdbf46:interior",
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
// POLICY_ID binds all four manifests (catalog-evidence-v2, v3-nvidia-621.14,
// v4-full-copy-r2, v5-flac-range) in order: sha256 of their SHA-256 digests joined
// by "+". Chaining the four digests directly would exceed the 256-character
// family evidence policy identity bound.
const POLICY_ID = "sdr-families-v2:2026-11-13:sha256:9e2629b57a57eab00103911bb8a5110e5b94eaa2724ecf1ccf0f3c74d0ceae08";
module.exports = { FAMILIES, POLICY_ID };
