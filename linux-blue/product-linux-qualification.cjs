 'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const EXPECTED_SHA = '08a097ef9eae71aa3340ad496c475ae5a3115adb8f7636b265c2eaee9e0274f3';
// Reviewed code is the trust anchor, not a caller manifest or writable JSON flag.
// This loader cannot hash itself recursively; package/source review binds it.
const SOURCE_PINS = {
  "linux-blue/candidate-calibration-runtime.cjs": {
    "bytes": 8695,
    "sha256": "a62ceab690931736a7d7a81e7c6c7495987f7015f953013366ab6f5a0fd8217a"
  },
  "linux-blue/product-linux-service.cjs": {
    "bytes": 14918,
    "sha256": "c64f4c8874c72f891eb96e62ff4677eb56f9e73569100c4b97a79fd25bc4fb89"
  },
  "linux-blue/product-linux-shell.cjs": {
    "bytes": 5805,
    "sha256": "cfb867b83f7b0cef1aca61fe29fc3c76bcda004752ee0d591b45ad8d0890031e"
  },
  "linux-blue/runtime-av1-operation.cjs": {
    "bytes": 5507,
    "sha256": "f664ec1a79ac95683bdb062633e454259dab25e8bfa00fecae7f8ed39dc921cc"
  },
  "linux-blue/runtime-av1-pins.json": {
    "bytes": 1160,
    "sha256": "d3f390eb66119e402042d17d3d0f96d44f24c3b657597d94ec5e54f9edc635c8"
  },
  "linux-blue/runtime-av1.cjs": {
    "bytes": 3480,
    "sha256": "f4e905f1e15fb86b0d20d9bde941d5e6c8ac2a0bb7b72adff41f056aef2e1e27"
  },
  "linux-blue/runtime-candidate-pins.json": {
    "bytes": 601,
    "sha256": "73aca3d1af30109cf20bf27dbeec759f267469781d13c9b8a18c07dd4d8c5e27"
  },
  "linux-blue/runtime-candidate.cjs": {
    "bytes": 4072,
    "sha256": "6958cdb86854d0e57fddd7cf8e793a7e944cbe600001338600a3953e610ad33e"
  },
  "linux-blue/runtime.cjs": {
    "bytes": 5005,
    "sha256": "0ddd5026996fa23e8122e359c340b08ff84a2786f56362099b38eaf8927331c8"
  },
  "linux-blue/flac-timing-qualification.cjs": {
    "bytes": 3155,
    "sha256": "52cf982f59ad76b974b84a2a23dcc9b0e0784f1a1f74901470b5c5e3377e879b"
  },
  "linux-blue/workbench-flac-calibration.cjs": {
    "bytes": 11305,
    "sha256": "a0ca87a0def08a367fdecc2ce46d069a81400af534f214d4fb4d03de76dceba1"
  },
  "linux-blue/workbench-long-range-calibration.cjs": {
    "bytes": 33448,
    "sha256": "63914e348d426d40566086a6a58aea87209d0e420197b7fab53de9306e1ac903"
  },
  "linux-blue/workbench-long-range-service.cjs": {
    "bytes": 15898,
    "sha256": "461ae64a8005f7635a3ad73dead9b7a322bcf3c69a8097cdc1adf3dafa47525b"
  },
  "linux-blue/workbench-remux.cjs": {
    "bytes": 7108,
    "sha256": "6a6cbf2a009a6ad48f6359e15d6c2432e615623c3b799df6dc29eb0eae4b4e2a"
  },
  "linux-blue/workbench-service.cjs": {
    "bytes": 8566,
    "sha256": "1f8ef2673fb3e0ea6d4cdbd8d7e726fee72d94dd9d54120d9cd7e9877fb52c80"
  },
  "linux-blue/workbench-trim-candidate.cjs": {
    "bytes": 9967,
    "sha256": "6e68df2eb93ddda8282b0a7cec8d6dbedff00871222a1f58ed7bc7e0a6d0c10f"
  },
  "main.js": {
    "bytes": 17853,
    "sha256": "53fe3a44dfbf52cc09e4f666a5b3e1ccc2c315a2da1f1aec333957e8654afe9b"
  },
  "package.json": {
    "bytes": 991,
    "sha256": "b5678dc133c1e5fb8da250bfe828c9da55f50d89dac3728af1f0870693e69a82"
  },
  "preload.js": {
    "bytes": 3766,
    "sha256": "7b3449ff9dfb9447547b438dacede602beb7c2c85abe5e6c1b44bc2facbcbf73"
  },
  "src/app-settings.cjs": {
    "bytes": 19769,
    "sha256": "b0e9a2c7da8a21ccc4f5a7223fb6176777aa14e4d02875c3d324bcb318aae970"
  },
  "src/appearance.cjs": {
    "bytes": 15587,
    "sha256": "ecf43ede703586f1f479ffd8193bedfcd1a4230b508a57a870a844202cbaa047"
  },
  "src/backend-adapters.cjs": {
    "bytes": 21754,
    "sha256": "7fbd1b2df2a0261e9d9b0457d224c4c3c77bfd2a4e16b497f8fb339d542847aa"
  },
  "src/backend-capabilities.cjs": {
    "bytes": 26589,
    "sha256": "33b6f2952f9fe106019c1416801f374cb9053d90bdd2b8df14e4c45b1df5b4c3"
  },
  "src/backend-discovery.cjs": {
    "bytes": 6646,
    "sha256": "66a3535d6bd8b4933e93ef7470b1c87be6e611fa731184f9909bb7ceabbffbd2"
  },
  "src/backend-observation.cjs": {
    "bytes": 25702,
    "sha256": "bcecce31a7de01aa8e3022f1deb7acd0033ff90130a1c8a6cc9fd4651e0e373a"
  },
  "src/backend-probe.cjs": {
    "bytes": 40078,
    "sha256": "22b8a83730d303bd5f8159b27ecc8f6be2cbee3df86128fdc749d8119c0c9139"
  },
  "src/candidate-runtime.cjs": {
    "bytes": 11835,
    "sha256": "92b8b5169302bfe0225ea5d5ca4802cec62c239b367605ce6f400f19eb0b50a9"
  },
  "src/capabilities.cjs": {
    "bytes": 13289,
    "sha256": "d7784aeae2535d49a8619ded8aee8ccbcfd3fd41662493952018c9d91e7c0be0"
  },
  "src/container-clock.cjs": {
    "bytes": 14696,
    "sha256": "b945f2c3c9c5082705f16b573fece0890e9b339a80a9458ad512dde0e2c01690"
  },
  "src/diagnostics.cjs": {
    "bytes": 48267,
    "sha256": "fa785aaca639324959339acceefbeaf7bfa1dfce4d38d27598b20c4d82df7901"
  },
  "src/encode-operation.cjs": {
    "bytes": 59039,
    "sha256": "4e671e0bff4d70d4d38fd450a738a6322176651ff6d0b492e6b79144f7c250f1"
  },
  "src/encode-preservation-catalog.cjs": {
    "bytes": 4821,
    "sha256": "1bce9f0b0c9a79a18e6d1c89fb181200ee366603dfe28097f1ace3d809bbf17f"
  },
  "src/encode-preservation-producers.cjs": {
    "bytes": 1106,
    "sha256": "0fd773d1bb0c0fab1af9d28861d80107e5e34809d7f3057467882d83f6f0de76"
  },
  "src/encode-preservation-workspace.cjs": {
    "bytes": 6795,
    "sha256": "30031b818ca362ea71c79a4cab6b6038e3b29ecaa5bc8efef00ce5fa5017bda9"
  },
  "src/encode-preservation.cjs": {
    "bytes": 15414,
    "sha256": "7de7fde7f20544f6b8480ca14b275865694163d3ed5608891c91c2be7aaabab4"
  },
  "src/encoder-catalog.cjs": {
    "bytes": 1611,
    "sha256": "1fd039577d83fbb35c8424d098fa06056822f538ae65e6b855c3021aab314cf2"
  },
  "src/encoder-service.cjs": {
    "bytes": 174131,
    "sha256": "8f11c951e8c5e98cc2d31f1607f61a00850c2827250b76bc3413d218811f0422"
  },
  "src/hdr-catalog-seals.cjs": {
    "bytes": 6748,
    "sha256": "e92d84a4688ea63b04f2b7190376f4a7d028c6a5c77768cf61eb38133117fda3"
  },
  "src/hdr-catalog.cjs": {
    "bytes": 6435,
    "sha256": "8efa4fc80256fbe73c5e7a4aaeebd91ad754339385441f1518112227cabab03f"
  },
  "src/hdr-container.cjs": {
    "bytes": 10506,
    "sha256": "8fc887ce472905d1642d7a855213a034cda0550e7bf6fa7c531c1c728f10d901"
  },
  "src/hdr-contract.cjs": {
    "bytes": 30407,
    "sha256": "3086db24ed02645cdb3663cdfc69303c1213689b5201c7d72b133a85c99828a4"
  },
  "src/hdr-encoding.cjs": {
    "bytes": 24145,
    "sha256": "91cdaaf3fc33d0fa7d4e982f588847a26c6bc23a755f05ef9ac8805e4b0858b8"
  },
  "src/hdr-evidence.cjs": {
    "bytes": 47759,
    "sha256": "ceb2bfd7ae65b5ec0534dbcb25a6caf017d806e48d8215c202db10f5cfaf316d"
  },
  "src/hdr-input.cjs": {
    "bytes": 29191,
    "sha256": "3e7373a4416410ad06c3130e4959f569c41a77ad90f3b7a860699f31584073f3"
  },
  "src/hdr-operation.cjs": {
    "bytes": 46409,
    "sha256": "0a269db9ea829f2478334b6ec8dfff1ae8477a71d23a00313bba7709c49dead7"
  },
  "src/hdr-workspace.cjs": {
    "bytes": 14989,
    "sha256": "20ae02c4dc3aa816a76ee7c5fb10b0f8d8fcf1c4cd010b0311065a60d3b358c7"
  },
  "src/hevc-content.cjs": {
    "bytes": 37132,
    "sha256": "5e3b70c3b5f8250ebb3b037e1ac6287b5d55ca768a99e9c964e79fef5382a931"
  },
  "src/inspection-cache.cjs": {
    "bytes": 13608,
    "sha256": "a8df2a0b65a4c4117e1efb903710ff159335424d4f3645adb53b99b278e55de1"
  },
  "src/inspection.cjs": {
    "bytes": 34123,
    "sha256": "441551923f7b6dde45e08e57ae53e52876ddd1f712d6662dd967ec0a1389e089"
  },
  "src/ipc.cjs": {
    "bytes": 9088,
    "sha256": "4342a871911f5d345d61d4764e7eb4e6c4554102226ea805f8e1c03c6aa564de"
  },
  "src/local-protocol.cjs": {
    "bytes": 1583,
    "sha256": "4bfd2c041224594d3f67e766e73bb692fc4345bc449193fdecc6b40dca1fc08b"
  },
  "src/media-evidence.cjs": {
    "bytes": 22167,
    "sha256": "102de80ca6e3e4509448e015d2012bed7025502584e2f934ae2dbe2dfad19502"
  },
  "src/media.cjs": {
    "bytes": 25811,
    "sha256": "2f3bc260e1969684e9374c9d60dc41cb326c0f6d5b09066649abfc8889b7f5c0"
  },
  "src/mov-representation.cjs": {
    "bytes": 10263,
    "sha256": "0155dc48d2b81e2c2b72d0e291c25dee372df2f37d7dbc592062724013b14348"
  },
  "src/native-backend-controls.cjs": {
    "bytes": 4282,
    "sha256": "432348cee4e5db6ba8f44be5c1eb4a5ff9b6431af0efa62676d61442c9e5c429"
  },
  "src/native-backend-service.cjs": {
    "bytes": 17026,
    "sha256": "ca7a9ea38034c992eb553f9a649f9d2c17411764c16d5aa016a1ae2ce78d6019"
  },
  "src/native-file-command.cjs": {
    "bytes": 7078,
    "sha256": "936116ef5e251ee4afaf0db8907082806a79c06c70159688417e26ecfecb5216"
  },
  "src/native-file-contract.cjs": {
    "bytes": 14520,
    "sha256": "2cf75cfb1b5ba25a51da513f311fe0287be4700fbf3893f9e27a1440e5e6e91a"
  },
  "src/native-file-controls.cjs": {
    "bytes": 34048,
    "sha256": "c8f9edab25393bf4944df0e07da239923b97a16f13fc5115842887efb97f81d6"
  },
  "src/native-file-oracle.cjs": {
    "bytes": 13381,
    "sha256": "0bdadd1e91acf494aa5baf2f5b2177953676f919047ccfa8f64d4eb9c9d2c1e4"
  },
  "src/native-file-runtime-pair.cjs": {
    "bytes": 7107,
    "sha256": "5e8dd98c7e2ab70406b5f57f82a8c25b24f1e0ca98e3256f759f3bf5a52107a8"
  },
  "src/native-file-runtime.cjs": {
    "bytes": 35319,
    "sha256": "c96ee8adcd48d5a76e6abd5f58310963f6321b5e663c43d6751826377f59f90a"
  },
  "src/native-file-source.cjs": {
    "bytes": 14081,
    "sha256": "d246f7b9e612f18ce210c56b80d08d5e3d8b4e89f4dab2de5253248dba0be8d9"
  },
  "src/native-file-template.cjs": {
    "bytes": 15284,
    "sha256": "0823a97b036e0bd2e342b59ac3f12a6bd85454d8870dc664ef524b7d53cc89f3"
  },
  "src/native-file-tools.cjs": {
    "bytes": 14238,
    "sha256": "da73dbecf1e13d2fef34a553f4f568370abf561c8bee7db5268076b9889ffb4f"
  },
  "src/native-file-workspace.cjs": {
    "bytes": 24501,
    "sha256": "433fcd2610c2530fef086b5151bbb01b70bb214ded14af5b2209e40db056d387"
  },
  "src/native-initialization-evidence.cjs": {
    "bytes": 3514,
    "sha256": "032d30b043934cfbb6e5063f799128ddabd6aef2aa7a6a3ec1c851153823caa7"
  },
  "src/operation-aac-discard-clock.cjs": {
    "bytes": 5563,
    "sha256": "3ac98fbdc72e31ae78d12a441cfaeb96eabf592bdf0a873ecd06ad4137be215b"
  },
  "src/operation-catalog.cjs": {
    "bytes": 14470,
    "sha256": "6f955334bfa4a3e567d4037b0ad1ce0fcb84a6a08e85a4b40bc45a6b594198ab"
  },
  "src/operation-contract.cjs": {
    "bytes": 29342,
    "sha256": "e87c0bd40a27e9bc4309cfff489a3270899edc6505face10a9c4461272bb343d"
  },
  "src/operation-controls.cjs": {
    "bytes": 8292,
    "sha256": "551246574d74d010d9179094dea47a9c12d5da7c9e5d1ce34fef6175a03b8c4e"
  },
  "src/operation-draft.cjs": {
    "bytes": 9030,
    "sha256": "9c4a25e65021be52bff887830a5cbdf5db07c03720be69b0352020437707251a"
  },
  "src/operation-evidence.cjs": {
    "bytes": 57827,
    "sha256": "b9bc49742b011929e4015d8441bea3101d12331f076717661c734568665971bc"
  },
  "src/operation-family.cjs": {
    "bytes": 59500,
    "sha256": "e342056e7b896a1cd61cf4da3c84c33d16ab792186d4a1ae4c30e5ddadbaf591"
  },
  "src/operation-names.cjs": {
    "bytes": 1511,
    "sha256": "185a019d034db77c0e6c4f06ffc7a4d32817296cf394f1fe6b8ede383977e56c"
  },
  "src/operation-resource-budget.cjs": {
    "bytes": 9231,
    "sha256": "2afe94d17bfced1bac25911d484dbf415f52a44404fdc9725858c3811e54cf6d"
  },
  "src/operation-runtime.cjs": {
    "bytes": 24869,
    "sha256": "a831147f2917a938e21083f2a56cc98597c834a464e1bcf1cdaebb937c62d294"
  },
  "src/operation-storage.cjs": {
    "bytes": 28430,
    "sha256": "fb9bcf00b2bf1fac3fe70f5421355a1aea0a2ded5358a38f41f7fd28fe7b1226"
  },
  "src/operation-subrip.cjs": {
    "bytes": 13754,
    "sha256": "3fd2bd2dcf7d1c01f1dfb1dcd3a854dae33dfaf0bbfc7c022a4e43f19972027a"
  },
  "src/operation-telemetry.cjs": {
    "bytes": 18149,
    "sha256": "ef1f30ac5d311224cb8b0e79f60f55f55c69c0610d920d17e5f9c7e191a55814"
  },
  "src/output-access.cjs": {
    "bytes": 12629,
    "sha256": "52e5ab6793ce5ea493fcc922d49dad3d25202cff50aaaca953a919bb5b1d8d0c"
  },
  "src/outputs.cjs": {
    "bytes": 24548,
    "sha256": "d61c0185f0af9104831cee015774bb8bd4656376e4b6f52b981e2aa7c011aff6"
  },
  "src/preferences.cjs": {
    "bytes": 10834,
    "sha256": "ba49926594e97665064f63b5db440ef9e3144c5b4eee6e60404af5dfde2f82c9"
  },
  "src/process-runner.cjs": {
    "bytes": 18389,
    "sha256": "8c2395eb2e2d7d32d8c11e756e3762d3ce04c926185b4b66d6b89df2f587af1f"
  },
  "src/provenance.cjs": {
    "bytes": 35994,
    "sha256": "3fcce843cbc995086adda7b45444c23acedce9d54813c01b92123d97cfcff894"
  },
  "src/regular-windows-runtime.cjs": {
    "bytes": 3348,
    "sha256": "6a4ff865f95b55b4afeeccc85781c1c213121f94c3bffdb23deff5a811d4fe76"
  },
  "src/remux-catalog.cjs": {
    "bytes": 8272,
    "sha256": "8acbdae5685ef158c70f4f3a10ef0fd0d01417e1647167c5e080ade9f05420a3"
  },
  "src/remux-contract.cjs": {
    "bytes": 38772,
    "sha256": "c8db0e1df72356716f4f2c888a0b324fd2cb467dd4e245f3498d1b1d9b441300"
  },
  "src/remux-ebml-reader.cjs": {
    "bytes": 12786,
    "sha256": "693f3f6fc8a1e22630691ccdbc99c5b82aaa5fbef0070f38215a1846a4005bd3"
  },
  "src/remux-edit-lists.cjs": {
    "bytes": 29526,
    "sha256": "2c43bcd88ee7772470abddc232d428751e37b95a072e4f989189a5a4178a99de"
  },
  "src/remux-evidence.cjs": {
    "bytes": 164636,
    "sha256": "a1871dcb74e2ef493a9a77a09002c87c2022d536c2c3e99123d6886a7d593719"
  },
  "src/remux-fragments.cjs": {
    "bytes": 5772,
    "sha256": "7f8df279d723d48b44c6ee8dbc1a4e2d9263b416a42a1812ef98e42eac1a5968"
  },
  "src/remux-language-codes.cjs": {
    "bytes": 921,
    "sha256": "84ec89c4d01c29b6be7de57cf99e4c13c0a73c573279b67cdac539799074afd6"
  },
  "src/remux-metadata-policy.cjs": {
    "bytes": 6530,
    "sha256": "56b613509412a0a986276a705e6fff57aa97577fd5b6def2aaec275781c129a8"
  },
  "src/remux-mkv-aac-clock.cjs": {
    "bytes": 9107,
    "sha256": "234a52dd6b3953c261d51d1ac03058bf70ffdc20e64db6a270e96c9c7198c89f"
  },
  "src/remux-mkv-aac-evidence.cjs": {
    "bytes": 19835,
    "sha256": "dc457d75398f7d73be94a779e45a96fb9ab2d73c2a960d29d5c07a6243ea9b12"
  },
  "src/remux-mp3-copy.cjs": {
    "bytes": 9444,
    "sha256": "e5059fabe6623eb979faa741b8328344af86522388414577c14bab06701ef5a2"
  },
  "src/remux-mp3-evidence.cjs": {
    "bytes": 7756,
    "sha256": "d28398c27a47753375372aa73081ca818f791cb23edb9cdde0017b95dc29a631"
  },
  "src/remux-mp3-source.cjs": {
    "bytes": 4519,
    "sha256": "072986180f2b5f443bcd4b74aacb90fe4569381d3a3703b8238868e319721971"
  },
  "src/remux-native-checks.cjs": {
    "bytes": 34435,
    "sha256": "41c92ef17de659504bf9b5bac8a80ce4e33af63f863916213d73bbefd28cda73"
  },
  "src/remux-native-cues.cjs": {
    "bytes": 6980,
    "sha256": "38ecafa1539434f95d74f9db994bbfd1672f729432e80efb4f4e7858c6dad072"
  },
  "src/remux-native-indexes.cjs": {
    "bytes": 10122,
    "sha256": "e14658f20cbb818eff9a7d2773ce3078e24db39caf0ed77ca0b0b6a5839ebbf8"
  },
  "src/remux-native-inventory.cjs": {
    "bytes": 86178,
    "sha256": "b98c0bbd232c6581cfaff9fd6579a2094baf7d0b48842a1a27910b32e45c5fa2"
  },
  "src/remux-native-isobmff.cjs": {
    "bytes": 8553,
    "sha256": "996d68381b22431b265af4f96138be5ca9fcd01b10e4fc13f9c3150629d1aced"
  },
  "src/remux-native-matroska.cjs": {
    "bytes": 14805,
    "sha256": "e6b2b011ca6b840cd1540f3491cace78f506e92a4c81dd2956e15d29a82e6a14"
  },
  "src/remux-native-reader.cjs": {
    "bytes": 7105,
    "sha256": "b9df0fcb3638d9ff251c70f57d94b040598d465d5b7731c28638b45a8fe436d1"
  },
  "src/remux-native-samples.cjs": {
    "bytes": 13302,
    "sha256": "ef79e3591a8b63e9d91400e709b7718f758222999eac408f16e6e86f37212fb2"
  },
  "src/remux-native-sync.cjs": {
    "bytes": 3729,
    "sha256": "9d24c8191d1ea6d35dee7f7727643def30c0a0b3def2b1c81dfdd00174da05c7"
  },
  "src/remux-operation.cjs": {
    "bytes": 48827,
    "sha256": "f98c9c35c119e56fc8b64d65f7364773784fedbbfd9cfbf700e8eb18919749c5"
  },
  "src/remux-transport-evidence.cjs": {
    "bytes": 20482,
    "sha256": "7d718265d8d41998e8da65c21f7c43833ebd010971e06d90e9f1161568eff20c"
  },
  "src/remux-transport.cjs": {
    "bytes": 28227,
    "sha256": "7cdafcb4f18c8b5dcd13ddc4a4738c4703c0b76f6f9d41b5005da7a7c700eed3"
  },
  "src/remux-validation.cjs": {
    "bytes": 43525,
    "sha256": "e554ab2e020baff103d726d2591feb1f18bbe72dac13fd17a92b135c0bf6fe47"
  },
  "src/remux-windows-chapters.cjs": {
    "bytes": 3872,
    "sha256": "628f31d33970c252460dcb6acbad0c06bad716c1ac9001e5ef1431db51d6c7de"
  },
  "src/remux-windows-subrip.cjs": {
    "bytes": 4214,
    "sha256": "9f6f4ffb6844e17c522504da6ff87e87ca627d70dd77acd5a43f7ca19c13c10b"
  },
  "src/remux-windows-two-aac.cjs": {
    "bytes": 8402,
    "sha256": "d30b5379e88b501c87751078054468198dd1f141c9f006c0b8840a8b183fcb76"
  },
  "src/remux-workspace.cjs": {
    "bytes": 23115,
    "sha256": "00812f435092efae682d4a3add4dbde08a122142043b78deb3c6575e4fd26faa"
  },
  "src/source-catalog-seals.cjs": {
    "bytes": 2619,
    "sha256": "87bfdd9f0f72a3d3c124a3f1befc8fe07a26daa727c18ba1c2fd77573c9404e7"
  },
  "src/source-identity.cjs": {
    "bytes": 9080,
    "sha256": "fe6f73342936aa70ed6bbda98348da6fb892d05ddb566ee6d1664ba3f38e42bd"
  },
  "src/storage-eligibility.cjs": {
    "bytes": 6195,
    "sha256": "a03a88ed0820beb807719d0e92ddbd761932efa8a11e9891cc6893902f930196"
  },
  "src/vendor-capabilities.cjs": {
    "bytes": 13443,
    "sha256": "ccfdbd2e35825a77919f25af06553f0bd7b744a1f219860854630600cdb5ac62"
  },
  "src/vendor-encode.cjs": {
    "bytes": 11018,
    "sha256": "71a10e6d08c293ed681bb5e1f7bbc176361204bd8d98cce14ddc18577827f71f"
  },
  "src/vendor-execution.cjs": {
    "bytes": 8441,
    "sha256": "4f9d08432499e3840e7b6c867f5b965c4466d58e8644a84d9655fcb323342f78"
  },
  "src/vendor-preferences.cjs": {
    "bytes": 6813,
    "sha256": "820033d07a8f0cef5de7bfd071537d0d26e4d778bb2e3cc82bc0699a4cbfad11"
  },
  "src/vendor-profiles.cjs": {
    "bytes": 8517,
    "sha256": "cc194f022665aa729410060804de2021175f0e87bd394fc18e4b3c47716cf65d"
  },
  "src/windows-adapters.cjs": {
    "bytes": 12888,
    "sha256": "8700b6de13ecf46e49d1b8bd7ac347b04232c86efd9b8a1eee2827d0d3265eb4"
  },
  "ui/renderer.js": {
    "bytes": 172406,
    "sha256": "a79eab909ae18994340904a9fba7f36bbdbd07becc25da72a307df86f28bd14f"
  },
  "linux-blue/candidate-full-copy-calibration.cjs": {
    "bytes": 27666,
    "sha256": "12aff9c8c7f2d58a0c1e2c64299c456918a965c16a41f35a28a6b3da0e1e228a"
  },
  "linux-blue/product-linux-ordinary-shell.cjs": {
    "bytes": 5205,
    "sha256": "cd16084b93bbeb7d0fc8c56c95fe79c829b04fa4d55f186cf9506c28792cc638"
  },
  "linux-blue/ordinary-cpu-service.cjs": {
    "bytes": 8656,
    "sha256": "9c857553374733f2bd9bd45a96384ebca6b29d8f1b21155d1ec31e0c7f504031"
  },
  "linux-blue/ordinary-cpu-policy.cjs": {
    "bytes": 5576,
    "sha256": "6931b850ea5341da6cee93b3dee443d5d871ead52197dbe62b6eff4fea3b0982"
  },
  "linux-blue/ordinary-cpu-stage-guard.cjs": {
    "bytes": 2901,
    "sha256": "ffea76d7b7e0f6ea65d1316000c2d554e0e91cba581908454e394cd8ef36a42c"
  },
  "linux-blue/product-linux-qualification074-historical.json": {
    "bytes": 8752,
    "sha256": "faa88a7c347e1a81c65c6c45f3d79b04453349d1da18ca40c3fbbcde5178f89a"
  },
  "linux-blue/evidence-2026-11-19/precision075-saved-audit.json": {
    "bytes": 4145,
    "sha256": "62ffebf1766562a869836dd8f004687bcc422e143198e5fddff948e71100c46a"
  },
  "linux-blue/evidence-2026-11-19/fullcopy075-saved-audit.json": {
    "bytes": 22243,
    "sha256": "afc414c9c349f45346b7a4fbfcf36a92737b1cbceffcd4eb9cdc140895d72445"
  },
  "linux-blue/evidence-2026-11-19/cpu075-saved-audit.json": {
    "bytes": 4645,
    "sha256": "96565b7fea8ccf103e2b3291abcf153f6b89ccd9fba9336947b1d4da8f8ea207"
  },
  "linux-blue/evidence-2026-11-19/late-range075-saved-audit.json": {
    "bytes": 19599,
    "sha256": "f0d9178b0f4f8d5d6ccfb7b7618bf6b54833020418fedbab35172d90679415da"
  },
  "linux-blue/evidence-2026-11-19/admission075-reasoning.json": {
    "bytes": 2203,
    "sha256": "1732b21e588af64fef4ca85b45c5e575c56fbe16b0b907df3a7012ae3a7a349f"
  },
  "linux-blue/evidence-2026-11-19/uhd-matrix-saved-audit.json": {
    "bytes": 5294,
    "sha256": "25ce864dfe915365f0c6e718807f8dd242b7d3f49748e5b22ef9a12c197f58fe"
  },
  "linux-blue/product-linux-qualification077-historical.json": {
    "bytes": 9245,
    "sha256": "6f7b0543f499e5c8dc58bbd0a0d9d77f0e8ecce4c4dd68b44127b4cec68b63d9"
  },
  "linux-blue/evidence-2026-11-19/uhd-matrix-frozen-references.json": {
    "bytes": 4224,
    "sha256": "ca3f2895d10ff045c96a7575c79e1f0adec05c95f31ed33c86a57d7baf5c7c0e"
  },
  "linux-blue/product-linux-remux-service.cjs": {
    "bytes": 17802,
    "sha256": "c51c2bd14975818d26d446fdb7d35646cbe5837842d8cc0665e8a4dc0da5ed5b"
  },
  "linux-blue/product-linux-remux-shell.cjs": {
    "bytes": 4810,
    "sha256": "f30066db5bb6f223797e0a6b3afcd659a0157bca3ff68f54655a73ee4bab18f3"
  },
  "linux-blue/product-linux-remux-qualification.cjs": {
    "bytes": 7753,
    "sha256": "357101b7161c698e8ee5fa12edb7ab16366bf47047cdc359ca13b89d2853f8dd"
  },
  "linux-blue/product-linux-remux-qualification.json": {
    "bytes": 1013,
    "sha256": "5a5080a0daf74d3c071c0739a32ada9901fb21ba94d8b9e10c1aceea4624b99c"
  },
  "linux-blue/evidence-2026-11-19/remux081-lifecycle-audit.json": {
    "bytes": 6839,
    "sha256": "ac2cc8d75a41a5fdc923f2816f92fdc8c29f11cc6aea7b6999d5d12238a2dad2"
  },
  "linux-blue/product-linux-unified-runtime.cjs": {
    "bytes": 9689,
    "sha256": "ded4c4731734d415ecc080198aac3c8828a1cf4db368fe941b4a1f4518cafa64"
  },
  "linux-blue/product-linux-unified-service.cjs": {
    "bytes": 39881,
    "sha256": "19859c98283ffb6c898823a243ed48fb9b4f24afca25202451bb73b441274a3a"
  },
  "linux-blue/product-linux-unified-shell.cjs": {
    "bytes": 1132,
    "sha256": "05d4aa6de8573b6725b5f87c131649cff5d039ab091953fbd3d2facfb2e6fe7d"
  },
  "linux-blue/av1-cpu-policy.cjs": {
    "bytes": 1310,
    "sha256": "e00494b6fede6d842de200a92bf580c76fc64cb79617c451d8f6363c4b3c62ef"
  },
  "linux-blue/h265-ordinary-policy.cjs": {
    "bytes": 1270,
    "sha256": "5e7a3b571f9b6d2f15491e9ecbd565948c354720117ce30a358e7462013dbdb2"
  },
  "linux-blue/aac-range-qualification.cjs": {
    "bytes": 3172,
    "sha256": "43eb35001e6040b34fdd833698921c36b4a16268ef93f7f91a361fa56efe669c"
  },
  "linux-blue/aac-range-qualification.json": {
    "bytes": 24514,
    "sha256": "aa127a854c3faff7d928905da4ad605630154a5f8e96a845873f79ade7f27517"
  },
  "linux-blue/evidence-2026-11-19/remux-matroska092-cell31-audit.json": {
    "bytes": 12395,
    "sha256": "588571024153da3ef42da682b66f0cbfce98915912efe5bdaa5e676c5cd5e7d0"
  },
  "linux-blue/evidence-2026-11-19/remux-matroska092-cell8-audit.json": {
    "bytes": 14656,
    "sha256": "8bc7103c3719ec05330c3b4382c6c0eff256439a9d2ba52ababc9ce22feb5817"
  },
  "linux-blue/evidence-2026-11-19/remux-matroska093-lifecycle-audit.json": {
    "bytes": 5310,
    "sha256": "d90a718c94e89e5294ac5f99e21795835fe12a1c01b45e26b477b3f5c8fd2fe0"
  },
  "linux-blue/product-linux-matroska-qualification.json": {
    "bytes": 1462,
    "sha256": "60642352bf753dec88de9d94d45a4f79536bc7236d212b65a564c2e132ddc449"
  },
  "linux-blue/product-linux-mov-qualification.json": {
    "bytes": 2013,
    "sha256": "e228403f8a3f8137cc34092c1c0db5964be58c7a2326a82b698ecaa5fcd552bd"
  },
  "linux-blue/evidence-2026-11-19/remux-mov095-lifecycle-audit.json": {
    "bytes": 17768,
    "sha256": "133f4eb0f593c6f30d72a822eef6cb334d855c4b34fb8f8c5e046c0f864d4246"
  },
  "linux-blue/evidence-2026-11-19/mov095-private-media-cell8-audit.json": {
    "bytes": 16322,
    "sha256": "d341bfb17977d00837de823c00a3e9659da2b74febb0589a6988c172fb6c3d6a"
  },
  "linux-blue/evidence-2026-11-19/mov095-private-media-cell31-audit.json": {
    "bytes": 16479,
    "sha256": "cf6a8229e89e3bff74f0f2e3a14198aa13f81d489e4e79a468ae478ca43f6230"
  },
  "linux-blue/evidence-2026-11-19/mov-cadence-service102-audit.json": {
    "bytes": 45046,
    "sha256": "fb7eb4164e9b5e0aa320b990869529db706922f0bb79fc1691844dab901c731b"
  },
  "linux-blue/product-linux-mov-cadence-qualification.json": {
    "bytes": 982,
    "sha256": "08c5cb4dae897c88c7365140e1b804c3ac99dc261749cb4bf886a0e65726faa6"
  },
  "linux-blue/product-two-aac-custody.cjs": {
    "bytes": 7429,
    "sha256": "dc3768879eb3967c79c26dac63e0d6ac7b787ef7fc41dba1de8e01cf11c04ca7"
  },
  "linux-blue/product-two-aac-evidence.cjs": {
    "bytes": 15484,
    "sha256": "187674ba93e4b4225d8cef3459abb08e747e1acc5ffcaf72d533b03568acd68f"
  },
  "linux-blue/product-two-aac-owner.cjs": {
    "bytes": 8885,
    "sha256": "837a78b8e868855af7deba2ff38597875653e8cad53913b6ccb4b9a1ffb52520"
  },
  "linux-blue/product-two-aac-record.cjs": {
    "bytes": 415,
    "sha256": "2db44067f1ac9ed57d84995a50dc599381260c3a295aef7b639e005fc923671b"
  },
  "linux-blue/product-mp3-source.cjs": {
    "bytes": 7623,
    "sha256": "e8b552a2e10dda42e2bc2b7431adbb63d761d823fa0cc8c8a3b99cbbf9d58389"
  },
  "linux-blue/product-mp3-inspection.cjs": {
    "bytes": 7978,
    "sha256": "93894552037b4abce9c92a2d0c97558b3ae0dee91a665af0c8963f127181c435"
  },
  "linux-blue/product-mp3-prepare.cjs": {
    "bytes": 4714,
    "sha256": "c85a2b894cace7a7c57c67aa8ac041225be9f41fec954122c0a11838abc8a1c2"
  }
};
const CLOSED_RECORD = {
  "schema": "linux-product-four-family-qualification/v5-uhd-full",
  "scope": "internal-opt-in-four-family-candidate",
  "runtimeIdentity": "dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13",
  "rawCalibration": {
    "sha256": "d8e48f1cbb9df2b5b55595d7c7d9860ef3421147e832e02efc31d06b0e08bb16",
    "sizeBytes": 78526
  },
  "independentCalibrationAuditSha256": "f0d9178b0f4f8d5d6ccfb7b7618bf6b54833020418fedbab35172d90679415da",
  "nativeProof": null,
  "productIntegrationReview": null,
  "family": {
    "settings": {
      "profileId": "h265-cpu",
      "preset": "slow",
      "quality": 25
    },
    "resourcePolicy": "cfr1440p30-to720p-flac-resources-v1",
    "geometry": {
      "sourceWidth": 2560,
      "sourceHeight": 1440,
      "resolution": "720",
      "outputWidth": 1280,
      "outputHeight": 720
    },
    "qualification": {
      "evidenceId": "fresh-resize1440to720-E8Fm1C:long-pattern:endpoints",
      "runtimeIdentity": "dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13",
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
      "evidenceId": "fresh-resize1440to720-E8Fm1C:long-pattern:interior",
      "runtimeIdentity": "dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13",
      "videoDurationUs": 1067,
      "audioTimelineUs": 1042,
      "aac": null
    },
    "evidenceIds": [
      "fresh-resize1440to720-DhJaK3:fresh-three-second-heldout:endpoints",
      "fresh-resize1440to720-DhJaK3:fresh-three-second-heldout:interior",
      "fresh-resize1440to720-E8Fm1C:long-pattern:endpoints",
      "fresh-resize1440to720-E8Fm1C:long-pattern:interior"
    ]
  },
  "runtimeSuccessor": {
    "historicalRecord": {
      "path": "linux-blue/product-linux-qualification074-historical.json",
      "bytes": 8752,
      "sha256": "faa88a7c347e1a81c65c6c45f3d79b04453349d1da18ca40c3fbbcde5178f89a"
    },
    "historicalRuntimeIdentity": "1980b0c0480dba85e00fb69f6994e9fd022b46d6355538ee24a445c87da337b9",
    "measuredActivation": true,
    "lateRangeEvidence": {
      "path": "linux-blue/evidence-2026-11-19/late-range075-saved-audit.json",
      "bytes": 19599,
      "sha256": "f0d9178b0f4f8d5d6ccfb7b7618bf6b54833020418fedbab35172d90679415da",
      "report": {
        "bytes": 78526,
        "sha256": "d8e48f1cbb9df2b5b55595d7c7d9860ef3421147e832e02efc31d06b0e08bb16"
      },
      "selectedFrames": 1200,
      "selectedSamples": 1920000,
      "completeSourceFrames": 4500,
      "completeSourceSamples": 7200000
    },
    "basis": "Fresh accepted short 1080/1440 precision, a 150-second 1440 source with a 100\u2013140-second selection, and eight-second Full-copy evidence bind the new exact runtime. Reviewed shared clocks, validators, resource policy and unchanged producer mechanisms support unchanged internal family admission; this is not measurement of every admitted duration or native/package acceptance. Historical runtime records retain their original identities.",
    "retainedLimits": [
      "27GiB free-space floor and existing family resource admission unchanged.",
      "Two-frame CPU tests are not broad encoding or performance qualification.",
      "x265 CPU-mask and thread-pool warnings retained; no affinity/security workaround.",
      "Remux evidence is media-only and does not activate remux.",
      "Actual fresh Full-copy coverage is the eight-second AAC case; the separate 11-second AAC heldout remains untested on this runtime. No 43.217-second FLAC evidence is represented as AAC-copy coverage.",
      "Other admitted durations and native journeys are not newly measured. Each output still requires the existing independent validation, currentness and publication guards."
    ],
    "admissionReasoning": {
      "path": "linux-blue/evidence-2026-11-19/admission075-reasoning.json",
      "bytes": 2203,
      "sha256": "1732b21e588af64fef4ca85b45c5e575c56fbe16b0b907df3a7012ae3a7a349f"
    }
  },
  "internalCandidateDecision": {
    "scope": "Explicit Linux internal candidate successor; not shipping catalog",
    "basis": "Accepted fresh bounded media audits and explicit shared-mechanism retest-scope review support internal admission, not inherited historical binary or native qualification.",
    "nativePublication": "pending new preserved and audited package",
    "productionDefault": "unchanged",
    "distributionReady": false,
    "pending": [
      "independent integration review and source preservation",
      "new inert package audit and bounded native journeys",
      "corresponding-source/notices and portable dependency obligations"
    ]
  },
  "supportingEvidence": {
    "precisionAudit": {
      "bytes": 4145,
      "sha256": "62ffebf1766562a869836dd8f004687bcc422e143198e5fddff948e71100c46a"
    },
    "cpuAudit": {
      "bytes": 4645,
      "sha256": "96565b7fea8ccf103e2b3291abcf153f6b89ccd9fba9336947b1d4da8f8ea207"
    },
    "lateRangeAudit": {
      "bytes": 19599,
      "sha256": "f0d9178b0f4f8d5d6ccfb7b7618bf6b54833020418fedbab35172d90679415da"
    }
  },
  "fullCopy": {
    "rawCalibration": {
      "sha256": "950f7a464d77410a73ad22af5ab77487da4a023069aaff6d99ba06451d203640",
      "sizeBytes": 69420
    },
    "supportingEvidence": {
      "calibrationAudit": {
        "bytes": 22243,
        "sha256": "afc414c9c349f45346b7a4fbfcf36a92737b1cbceffcd4eb9cdc140895d72445"
      }
    },
    "nativeProof": null,
    "relocatedPublication": null,
    "family": {
      "settings": {
        "profileId": "h265-cpu",
        "preset": "slow",
        "quality": 25
      },
      "resourcePolicy": "cfr1080p30-full-to720-copy-resources-v1",
      "geometry": {
        "sourceWidth": 1920,
        "sourceHeight": 1080,
        "resolution": "720",
        "outputWidth": 1280,
        "outputHeight": 720
      },
      "qualification": {
        "evidenceId": "successor075-short-full-copy-950f7a464d77410a:endpoints",
        "runtimeIdentity": "dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13",
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
        "evidenceId": "successor075-short-full-copy-950f7a464d77410a:interior",
        "runtimeIdentity": "dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13",
        "videoDurationUs": 1067,
        "audioTimelineUs": 1042,
        "aac": null
      },
      "evidenceIds": [
        "successor075-short-full-copy-950f7a464d77410a:endpoints",
        "successor075-short-full-copy-950f7a464d77410a:interior"
      ]
    },
    "limits": [
      "New eight-second1080p30 whole-file720pH265slow25 copiedAAC experiment only.",
      "Exact packet/header identity and padding/timeline evidence retained in owning audit. No automatic long-duration, native, GPU or production qualification."
    ]
  },
  "range1080": {
    "rawCalibration": {
      "sha256": "a2f7a2d143f7b7f1063550da7443a7c96177a8894f2809ad0f8787f9847320fc",
      "sizeBytes": 75744
    },
    "supportingEvidence": {
      "calibrationAudit": {
        "bytes": 4145,
        "sha256": "62ffebf1766562a869836dd8f004687bcc422e143198e5fddff948e71100c46a"
      }
    },
    "nativeProof": null,
    "relocatedPublication": null,
    "family": {
      "settings": {
        "profileId": "h265-cpu",
        "preset": "slow",
        "quality": 25
      },
      "resourcePolicy": "cfr1080p30-to720p-flac-resources-v1",
      "geometry": {
        "sourceWidth": 1920,
        "sourceHeight": 1080,
        "resolution": "720",
        "outputWidth": 1280,
        "outputHeight": 720
      },
      "qualification": {
        "evidenceId": "fresh-resize1080to720-hsl22R:fresh-three-second-heldout:endpoints",
        "runtimeIdentity": "dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13",
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
        "evidenceId": "fresh-resize1080to720-hsl22R:fresh-three-second-heldout:interior",
        "runtimeIdentity": "dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13",
        "videoDurationUs": 1067,
        "audioTimelineUs": 1042,
        "aac": null
      },
      "evidenceIds": [
        "fresh-resize1080to720-hsl22R:fresh-three-second-heldout:endpoints",
        "fresh-resize1080to720-hsl22R:fresh-three-second-heldout:interior"
      ]
    },
    "limits": [
      "New three-second source/nonaligned0.613\u20132.721 range experiment only.",
      "H264High30fpsSDRBT709 squarepixel stereo48kHzs16PCM source; no arbitrary AAC/VFR/HDR/GPU admission.",
      "Historical long campaigns remain old runtime evidence, not silently reassigned to this pair."
    ]
  },
  "uhdFull": {
    "rawMatrixSummary": {
      "bytes": 198731,
      "sha256": "d749b09c1eee5096376c7f667642e8214d3e2c8df02553dd31c2a6608d3bc478"
    },
    "savedAudit": {
      "path": "linux-blue/evidence-2026-11-19/uhd-matrix-saved-audit.json",
      "bytes": 5294,
      "sha256": "25ce864dfe915365f0c6e718807f8dd242b7d3f49748e5b22ef9a12c197f58fe"
    },
    "predecessorRecord": {
      "path": "linux-blue/product-linux-qualification077-historical.json",
      "bytes": 9245,
      "sha256": "6f7b0543f499e5c8dc58bbd0a0d9d77f0e8ecce4c4dd68b44127b4cec68b63d9"
    },
    "nativeProof": null,
    "relocatedPublication": null,
    "family": {
      "settings": {
        "profileId": "h265-cpu",
        "preset": "slow",
        "quality": 25
      },
      "resourcePolicy": "cfr2160p30-full-to1440-1080-720-flac-resources-v1",
      "sourceGeometry": {
        "width": 3840,
        "height": 2160
      },
      "resolutions": [
        "1440",
        "1080",
        "720"
      ],
      "qualification": {
        "evidenceId": "fresh-uhdFull-zeTK39:fresh-eight-second-uhd:endpoints",
        "runtimeIdentity": "dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13",
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
        "evidenceId": "fresh-uhdFull-zeTK39:fresh-eight-second-uhd:interior",
        "runtimeIdentity": "dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13",
        "videoDurationUs": 1067,
        "audioTimelineUs": 1042,
        "aac": null
      },
      "evidenceIds": [
        "fresh-uhdFull-zeTK39:fresh-eight-second-uhd:endpoints",
        "fresh-uhdFull-zeTK39:fresh-eight-second-uhd:interior"
      ]
    },
    "limits": [
      "Fresh eight-second synthetic SDR CFR30 H264 High/yuv420p BT709 square-pixel unrotated QuickTime with stereo48kHz s16 PCM; three Full-source H265slow25 FLAC targets only.",
      "HDR, VFR, DCI4K, AAC, range and GPU routes remain outside this family. No ordinary/default changes.",
      "Original clock-derived bounds unchanged; supplementary SSIM is not a perceptual threshold or independent visual-correctness proof.",
      "No new packaged/native publication or broad-duration/performance qualification; per-output original validation/currentness guards remain mandatory."
    ],
    "frozenReferences": {
      "path": "linux-blue/evidence-2026-11-19/uhd-matrix-frozen-references.json",
      "bytes": 4224,
      "sha256": "ca3f2895d10ff045c96a7575c79e1f0adec05c95f31ed33c86a57d7baf5c7c0e"
    }
  }
};
const digest = b => createHash('sha256').update(b).digest('hex');
function frozen(value) { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
const SERVICE_SUCCESSOR = {
  "scope": "explicit-service-integration-successor-not-new-calibration",
  "historicalEncoderService": {
    "bytes": 158909,
    "sha256": "5f1d0ed985bb82166f52b8498f69e72e30e018973f7c1ee361f745a26e643dc7"
  },
  "currentEncoderService": {
    "bytes": 160678,
    "sha256": "7e11a4409a961de7d1cfa36c80e909f3443b5484573c6b48713964f963ff0c30"
  },
  "historicalRangeProducerCount": 97,
  "unchangedRangeProducerCount": 93,
  "historicalFullCopyProducerCount": 26,
  "nativeProof": null,
  "basis": "Optional ordinary guard is absent on measured service instances. Original raw producer maps and numerical calibration records remain unchanged; current service integration requires separate review/tests and fresh packaged native regression. Explicit UHD-only Full family, output-sized budget extension and collector policy are separate reviewed successor changes; legacy branches remain unchanged. UHD saved matrix tests the new paths, not historical binary reassignment.",
  "uhdSourceDeltas": {
    "src/operation-family.cjs": {
      "historicalSha256": "3e27335e4228969d670545b0fb6aeb77a6fd9303529c248ae7560d0c9e4fade3",
      "currentSha256": "2f30becd87c6b181873c99fbbbe0b5cf2ddc75c33cfb30189d5bedf237e63fb9"
    },
    "src/operation-resource-budget.cjs": {
      "historicalSha256": "9a328f902ee4203465083da4afd477ad86d045654104fe33409cb571cd02d3f6",
      "currentSha256": "2afe94d17bfced1bac25911d484dbf415f52a44404fdc9725858c3811e54cf6d"
    },
    "src/operation-evidence.cjs": {
      "historicalSha256": "5ec5452881d01789f7f181e4540cfcca268371f13f6abdd7f59fa9ad57e8b8d4",
      "currentSha256": "55cb42b3e8e5f7886e1909058a136a63723c5b4cb4056a89345d3df16a7eef44"
    }
  }
};
const AAC_SERVICE_SUCCESSOR = {
  "scope": "explicit-reviewed-AAC-entry-controls-successor-not-historical-requalification",
  "priorCurrentSource": {
    "bytes": 160678,
    "sha256": "7e11a4409a961de7d1cfa36c80e909f3443b5484573c6b48713964f963ff0c30"
  },
  "currentSource": {
    "bytes": 164039,
    "sha256": "b5327f15fd378d11475239cc8c00a6875f04b4d01efbc94b28ae7827fa3788b2"
  },
  "functionalReviewSha256": "f01f99c4d6b970bd477c766bfa297068c4b8b563447cd199d135377dab62f9a3",
  "basis": "Default per-entry controls preserve existing service globals. Linux fixed AAC uses copied frozen prepared controls, checked before ownership, after awaited currentness and at execution; no global deadline widening. Original historical SERVICE_SUCCESSOR and numerical producer maps remain unchanged.",
  "evidence": "Fixed separately audited A and B records in aac-range-qualification.json;1080 source is mechanism-supported rather than a third acquired cell.",
  "nativeProof": null
};
frozen(SOURCE_PINS); frozen(CLOSED_RECORD); frozen(SERVICE_SUCCESSOR); frozen(AAC_SERVICE_SUCCESSOR);
const stamp = s => ['dev','ino','nlink','size','mtimeNs','ctimeNs','birthtimeNs'].map(k => String(s[k]));
function ordinaryRead(root, relative, cap) {
  assert(path.isAbsolute(root) && path.resolve(root) === root && fs.realpathSync(root) === root);
  assert(typeof relative === 'string' && relative.split('/').every(x => x && x !== '.' && x !== '..') && !/[\\:\x00-\x1f\x7f]/.test(relative));
  const names = relative.split('/'); let parent = root;
  for (const part of ['', ...names.slice(0,-1)]) {
    if (part) parent = path.join(parent, part);
    const stat = fs.lstatSync(parent, {bigint:true});
    assert(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(parent) === parent);
  }
  const target = path.join(root, ...names), entry = fs.lstatSync(target, {bigint:true});
  assert(entry.isFile() && entry.nlink === 1n && entry.size <= BigInt(cap));
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, {bigint:true}); assert.deepEqual(stamp(before), stamp(entry));
    // Size is admitted before allocation. One extra byte detects growth.
    const b = Buffer.alloc(Number(before.size) + 1); let size = 0, count;
    while ((count = fs.readSync(fd, b, size, b.length-size, null)) > 0) { size += count; assert(size <= Number(before.size)); }
    assert.equal(size, Number(before.size));
    assert.deepEqual(stamp(fs.fstatSync(fd,{bigint:true})),stamp(before));
    assert.deepEqual(stamp(fs.lstatSync(target,{bigint:true})),stamp(before));
    assert.equal(fs.realpathSync(target),target);
    return b.subarray(0,size);
  } finally { fs.closeSync(fd); }
}
function readCompactQualification() {
  try {
    const bytes = ordinaryRead(__dirname,'product-linux-qualification.json',16384);
    assert.equal(digest(bytes), EXPECTED_SHA);
    const value = JSON.parse(bytes.toString('utf8'));
    // Closed reviewed schema and values: missing/extra fields and changed types refuse.
    assert(isDeepStrictEqual(value,CLOSED_RECORD));
    return frozen(value);
  } catch (cause) { throw Object.assign(new Error('Product qualification differs from the reviewed ordinary bounded record.', {cause}), {code:'LINUX_PRODUCT_QUALIFICATION_CHANGED'}); }
}
function verifyProductSources() {
  try {
    const root = path.resolve(__dirname,'..'); let total = 0;
    assert(Object.keys(SOURCE_PINS).length <= 256);
    for (const [name,pin] of Object.entries(SOURCE_PINS)) {
      assert(pin.bytes <= 4*1024*1024); total += pin.bytes; assert(total <= 32*1024*1024);
      const bytes = ordinaryRead(root,name,pin.bytes);
      assert.equal(bytes.length,pin.bytes); assert.equal(digest(bytes),pin.sha256);
    }
    return Object.freeze({scope:'reviewed-product-source-closure-only', files:Object.keys(SOURCE_PINS).length, usableForEncoding:false});
  } catch(cause) { throw Object.assign(new Error('Product source closure changed.',{cause}),{code:'LINUX_PRODUCT_SOURCE_CHANGED'}); }
}
function loadQualification() {
  // Only this exact reviewed internal-candidate record and current source closure
  // are admitted. This does not grant production catalog or native acceptance.
  const qualification = readCompactQualification(); verifyProductSources();
  return qualification;
}

module.exports = { loadQualification, readCompactQualification, verifyProductSources, SERVICE_SUCCESSOR, AAC_SERVICE_SUCCESSOR };
