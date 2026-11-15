'use strict';
// Schema identifiers/defaults only; no downloaded executable code.
// https://raw.githubusercontent.com/ietf-wg-cellar/matroska-specification/master/ebml_matroska.xml
// XML SHA-256 a42a9c6ea47dfd83589ce04a508b6a7f5d038560cee11dee1e4cbe2e746d0939
const MATROSKA_SCHEMA = [
  {
    "name": "EBMLMaxIDLength",
    "id": "0x42f2",
    "type": "uinteger",
    "path": "\\EBML\\EBMLMaxIDLength",
    "default": "4"
  },
  {
    "name": "EBMLMaxSizeLength",
    "id": "0x42f3",
    "type": "uinteger",
    "path": "\\EBML\\EBMLMaxSizeLength",
    "default": "8"
  },
  {
    "name": "Segment",
    "id": "0x18538067",
    "type": "master",
    "path": "\\Segment",
    "default": null
  },
  {
    "name": "SeekHead",
    "id": "0x114d9b74",
    "type": "master",
    "path": "\\Segment\\SeekHead",
    "default": null
  },
  {
    "name": "Seek",
    "id": "0x4dbb",
    "type": "master",
    "path": "\\Segment\\SeekHead\\Seek",
    "default": null
  },
  {
    "name": "SeekID",
    "id": "0x53ab",
    "type": "binary",
    "path": "\\Segment\\SeekHead\\Seek\\SeekID",
    "default": null
  },
  {
    "name": "SeekPosition",
    "id": "0x53ac",
    "type": "uinteger",
    "path": "\\Segment\\SeekHead\\Seek\\SeekPosition",
    "default": null
  },
  {
    "name": "Info",
    "id": "0x1549a966",
    "type": "master",
    "path": "\\Segment\\Info",
    "default": null
  },
  {
    "name": "SegmentUUID",
    "id": "0x73a4",
    "type": "binary",
    "path": "\\Segment\\Info\\SegmentUUID",
    "default": null
  },
  {
    "name": "SegmentFilename",
    "id": "0x7384",
    "type": "utf-8",
    "path": "\\Segment\\Info\\SegmentFilename",
    "default": null
  },
  {
    "name": "PrevUUID",
    "id": "0x3cb923",
    "type": "binary",
    "path": "\\Segment\\Info\\PrevUUID",
    "default": null
  },
  {
    "name": "PrevFilename",
    "id": "0x3c83ab",
    "type": "utf-8",
    "path": "\\Segment\\Info\\PrevFilename",
    "default": null
  },
  {
    "name": "NextUUID",
    "id": "0x3eb923",
    "type": "binary",
    "path": "\\Segment\\Info\\NextUUID",
    "default": null
  },
  {
    "name": "NextFilename",
    "id": "0x3e83bb",
    "type": "utf-8",
    "path": "\\Segment\\Info\\NextFilename",
    "default": null
  },
  {
    "name": "SegmentFamily",
    "id": "0x4444",
    "type": "binary",
    "path": "\\Segment\\Info\\SegmentFamily",
    "default": null
  },
  {
    "name": "ChapterTranslate",
    "id": "0x6924",
    "type": "master",
    "path": "\\Segment\\Info\\ChapterTranslate",
    "default": null
  },
  {
    "name": "ChapterTranslateID",
    "id": "0x69a5",
    "type": "binary",
    "path": "\\Segment\\Info\\ChapterTranslate\\ChapterTranslateID",
    "default": null
  },
  {
    "name": "ChapterTranslateCodec",
    "id": "0x69bf",
    "type": "uinteger",
    "path": "\\Segment\\Info\\ChapterTranslate\\ChapterTranslateCodec",
    "default": null
  },
  {
    "name": "ChapterTranslateEditionUID",
    "id": "0x69fc",
    "type": "uinteger",
    "path": "\\Segment\\Info\\ChapterTranslate\\ChapterTranslateEditionUID",
    "default": null
  },
  {
    "name": "TimestampScale",
    "id": "0x2ad7b1",
    "type": "uinteger",
    "path": "\\Segment\\Info\\TimestampScale",
    "default": "1000000"
  },
  {
    "name": "Duration",
    "id": "0x4489",
    "type": "float",
    "path": "\\Segment\\Info\\Duration",
    "default": null
  },
  {
    "name": "DateUTC",
    "id": "0x4461",
    "type": "date",
    "path": "\\Segment\\Info\\DateUTC",
    "default": null
  },
  {
    "name": "Title",
    "id": "0x7ba9",
    "type": "utf-8",
    "path": "\\Segment\\Info\\Title",
    "default": null
  },
  {
    "name": "MuxingApp",
    "id": "0x4d80",
    "type": "utf-8",
    "path": "\\Segment\\Info\\MuxingApp",
    "default": null
  },
  {
    "name": "WritingApp",
    "id": "0x5741",
    "type": "utf-8",
    "path": "\\Segment\\Info\\WritingApp",
    "default": null
  },
  {
    "name": "Cluster",
    "id": "0x1f43b675",
    "type": "master",
    "path": "\\Segment\\Cluster",
    "default": null
  },
  {
    "name": "Timestamp",
    "id": "0xe7",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\Timestamp",
    "default": null
  },
  {
    "name": "SilentTracks",
    "id": "0x5854",
    "type": "master",
    "path": "\\Segment\\Cluster\\SilentTracks",
    "default": null
  },
  {
    "name": "SilentTrackNumber",
    "id": "0x58d7",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\SilentTracks\\SilentTrackNumber",
    "default": null
  },
  {
    "name": "Position",
    "id": "0xa7",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\Position",
    "default": null
  },
  {
    "name": "PrevSize",
    "id": "0xab",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\PrevSize",
    "default": null
  },
  {
    "name": "SimpleBlock",
    "id": "0xa3",
    "type": "binary",
    "path": "\\Segment\\Cluster\\SimpleBlock",
    "default": null
  },
  {
    "name": "BlockGroup",
    "id": "0xa0",
    "type": "master",
    "path": "\\Segment\\Cluster\\BlockGroup",
    "default": null
  },
  {
    "name": "Block",
    "id": "0xa1",
    "type": "binary",
    "path": "\\Segment\\Cluster\\BlockGroup\\Block",
    "default": null
  },
  {
    "name": "BlockVirtual",
    "id": "0xa2",
    "type": "binary",
    "path": "\\Segment\\Cluster\\BlockGroup\\BlockVirtual",
    "default": null
  },
  {
    "name": "BlockAdditions",
    "id": "0x75a1",
    "type": "master",
    "path": "\\Segment\\Cluster\\BlockGroup\\BlockAdditions",
    "default": null
  },
  {
    "name": "BlockMore",
    "id": "0xa6",
    "type": "master",
    "path": "\\Segment\\Cluster\\BlockGroup\\BlockAdditions\\BlockMore",
    "default": null
  },
  {
    "name": "BlockAdditional",
    "id": "0xa5",
    "type": "binary",
    "path": "\\Segment\\Cluster\\BlockGroup\\BlockAdditions\\BlockMore\\BlockAdditional",
    "default": null
  },
  {
    "name": "BlockAddID",
    "id": "0xee",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\BlockGroup\\BlockAdditions\\BlockMore\\BlockAddID",
    "default": "1"
  },
  {
    "name": "BlockDuration",
    "id": "0x9b",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\BlockGroup\\BlockDuration",
    "default": null
  },
  {
    "name": "ReferencePriority",
    "id": "0xfa",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\BlockGroup\\ReferencePriority",
    "default": "0"
  },
  {
    "name": "ReferenceBlock",
    "id": "0xfb",
    "type": "integer",
    "path": "\\Segment\\Cluster\\BlockGroup\\ReferenceBlock",
    "default": null
  },
  {
    "name": "ReferenceVirtual",
    "id": "0xfd",
    "type": "integer",
    "path": "\\Segment\\Cluster\\BlockGroup\\ReferenceVirtual",
    "default": null
  },
  {
    "name": "CodecState",
    "id": "0xa4",
    "type": "binary",
    "path": "\\Segment\\Cluster\\BlockGroup\\CodecState",
    "default": null
  },
  {
    "name": "DiscardPadding",
    "id": "0x75a2",
    "type": "integer",
    "path": "\\Segment\\Cluster\\BlockGroup\\DiscardPadding",
    "default": null
  },
  {
    "name": "Slices",
    "id": "0x8e",
    "type": "master",
    "path": "\\Segment\\Cluster\\BlockGroup\\Slices",
    "default": null
  },
  {
    "name": "TimeSlice",
    "id": "0xe8",
    "type": "master",
    "path": "\\Segment\\Cluster\\BlockGroup\\Slices\\TimeSlice",
    "default": null
  },
  {
    "name": "LaceNumber",
    "id": "0xcc",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\BlockGroup\\Slices\\TimeSlice\\LaceNumber",
    "default": null
  },
  {
    "name": "FrameNumber",
    "id": "0xcd",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\BlockGroup\\Slices\\TimeSlice\\FrameNumber",
    "default": "0"
  },
  {
    "name": "BlockAdditionID",
    "id": "0xcb",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\BlockGroup\\Slices\\TimeSlice\\BlockAdditionID",
    "default": "0"
  },
  {
    "name": "Delay",
    "id": "0xce",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\BlockGroup\\Slices\\TimeSlice\\Delay",
    "default": "0"
  },
  {
    "name": "SliceDuration",
    "id": "0xcf",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\BlockGroup\\Slices\\TimeSlice\\SliceDuration",
    "default": "0"
  },
  {
    "name": "ReferenceFrame",
    "id": "0xc8",
    "type": "master",
    "path": "\\Segment\\Cluster\\BlockGroup\\ReferenceFrame",
    "default": null
  },
  {
    "name": "ReferenceOffset",
    "id": "0xc9",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\BlockGroup\\ReferenceFrame\\ReferenceOffset",
    "default": null
  },
  {
    "name": "ReferenceTimestamp",
    "id": "0xca",
    "type": "uinteger",
    "path": "\\Segment\\Cluster\\BlockGroup\\ReferenceFrame\\ReferenceTimestamp",
    "default": null
  },
  {
    "name": "EncryptedBlock",
    "id": "0xaf",
    "type": "binary",
    "path": "\\Segment\\Cluster\\EncryptedBlock",
    "default": null
  },
  {
    "name": "Tracks",
    "id": "0x1654ae6b",
    "type": "master",
    "path": "\\Segment\\Tracks",
    "default": null
  },
  {
    "name": "TrackEntry",
    "id": "0xae",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry",
    "default": null
  },
  {
    "name": "TrackNumber",
    "id": "0xd7",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackNumber",
    "default": null
  },
  {
    "name": "TrackUID",
    "id": "0x73c5",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackUID",
    "default": null
  },
  {
    "name": "TrackType",
    "id": "0x83",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackType",
    "default": null
  },
  {
    "name": "FlagEnabled",
    "id": "0xb9",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\FlagEnabled",
    "default": "1"
  },
  {
    "name": "FlagDefault",
    "id": "0x88",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\FlagDefault",
    "default": "1"
  },
  {
    "name": "FlagForced",
    "id": "0x55aa",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\FlagForced",
    "default": "0"
  },
  {
    "name": "FlagHearingImpaired",
    "id": "0x55ab",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\FlagHearingImpaired",
    "default": null
  },
  {
    "name": "FlagVisualImpaired",
    "id": "0x55ac",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\FlagVisualImpaired",
    "default": null
  },
  {
    "name": "FlagTextDescriptions",
    "id": "0x55ad",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\FlagTextDescriptions",
    "default": null
  },
  {
    "name": "FlagOriginal",
    "id": "0x55ae",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\FlagOriginal",
    "default": null
  },
  {
    "name": "FlagCommentary",
    "id": "0x55af",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\FlagCommentary",
    "default": null
  },
  {
    "name": "FlagLacing",
    "id": "0x9c",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\FlagLacing",
    "default": "1"
  },
  {
    "name": "MinCache",
    "id": "0x6de7",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\MinCache",
    "default": "0"
  },
  {
    "name": "MaxCache",
    "id": "0x6df8",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\MaxCache",
    "default": null
  },
  {
    "name": "DefaultDuration",
    "id": "0x23e383",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\DefaultDuration",
    "default": null
  },
  {
    "name": "DefaultDecodedFieldDuration",
    "id": "0x234e7a",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\DefaultDecodedFieldDuration",
    "default": null
  },
  {
    "name": "TrackTimestampScale",
    "id": "0x23314f",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackTimestampScale",
    "default": "0x1p+0"
  },
  {
    "name": "TrackOffset",
    "id": "0x537f",
    "type": "integer",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackOffset",
    "default": "0"
  },
  {
    "name": "MaxBlockAdditionID",
    "id": "0x55ee",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\MaxBlockAdditionID",
    "default": "0"
  },
  {
    "name": "BlockAdditionMapping",
    "id": "0x41e4",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\BlockAdditionMapping",
    "default": null
  },
  {
    "name": "BlockAddIDValue",
    "id": "0x41f0",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\BlockAdditionMapping\\BlockAddIDValue",
    "default": null
  },
  {
    "name": "BlockAddIDName",
    "id": "0x41a4",
    "type": "string",
    "path": "\\Segment\\Tracks\\TrackEntry\\BlockAdditionMapping\\BlockAddIDName",
    "default": null
  },
  {
    "name": "BlockAddIDType",
    "id": "0x41e7",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\BlockAdditionMapping\\BlockAddIDType",
    "default": "0"
  },
  {
    "name": "BlockAddIDExtraData",
    "id": "0x41ed",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\BlockAdditionMapping\\BlockAddIDExtraData",
    "default": null
  },
  {
    "name": "Name",
    "id": "0x536e",
    "type": "utf-8",
    "path": "\\Segment\\Tracks\\TrackEntry\\Name",
    "default": null
  },
  {
    "name": "Language",
    "id": "0x22b59c",
    "type": "string",
    "path": "\\Segment\\Tracks\\TrackEntry\\Language",
    "default": "eng"
  },
  {
    "name": "LanguageBCP47",
    "id": "0x22b59d",
    "type": "string",
    "path": "\\Segment\\Tracks\\TrackEntry\\LanguageBCP47",
    "default": null
  },
  {
    "name": "CodecID",
    "id": "0x86",
    "type": "string",
    "path": "\\Segment\\Tracks\\TrackEntry\\CodecID",
    "default": null
  },
  {
    "name": "CodecPrivate",
    "id": "0x63a2",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\CodecPrivate",
    "default": null
  },
  {
    "name": "CodecName",
    "id": "0x258688",
    "type": "utf-8",
    "path": "\\Segment\\Tracks\\TrackEntry\\CodecName",
    "default": null
  },
  {
    "name": "AttachmentLink",
    "id": "0x7446",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\AttachmentLink",
    "default": null
  },
  {
    "name": "CodecSettings",
    "id": "0x3a9697",
    "type": "utf-8",
    "path": "\\Segment\\Tracks\\TrackEntry\\CodecSettings",
    "default": null
  },
  {
    "name": "CodecInfoURL",
    "id": "0x3b4040",
    "type": "string",
    "path": "\\Segment\\Tracks\\TrackEntry\\CodecInfoURL",
    "default": null
  },
  {
    "name": "CodecDownloadURL",
    "id": "0x26b240",
    "type": "string",
    "path": "\\Segment\\Tracks\\TrackEntry\\CodecDownloadURL",
    "default": null
  },
  {
    "name": "CodecDecodeAll",
    "id": "0xaa",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\CodecDecodeAll",
    "default": "1"
  },
  {
    "name": "TrackOverlay",
    "id": "0x6fab",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackOverlay",
    "default": null
  },
  {
    "name": "CodecDelay",
    "id": "0x56aa",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\CodecDelay",
    "default": "0"
  },
  {
    "name": "SeekPreRoll",
    "id": "0x56bb",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\SeekPreRoll",
    "default": "0"
  },
  {
    "name": "TrackTranslate",
    "id": "0x6624",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackTranslate",
    "default": null
  },
  {
    "name": "TrackTranslateTrackID",
    "id": "0x66a5",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackTranslate\\TrackTranslateTrackID",
    "default": null
  },
  {
    "name": "TrackTranslateCodec",
    "id": "0x66bf",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackTranslate\\TrackTranslateCodec",
    "default": null
  },
  {
    "name": "TrackTranslateEditionUID",
    "id": "0x66fc",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackTranslate\\TrackTranslateEditionUID",
    "default": null
  },
  {
    "name": "Video",
    "id": "0xe0",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video",
    "default": null
  },
  {
    "name": "FlagInterlaced",
    "id": "0x9a",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\FlagInterlaced",
    "default": "0"
  },
  {
    "name": "FieldOrder",
    "id": "0x9d",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\FieldOrder",
    "default": "2"
  },
  {
    "name": "StereoMode",
    "id": "0x53b8",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\StereoMode",
    "default": "0"
  },
  {
    "name": "AlphaMode",
    "id": "0x53c0",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\AlphaMode",
    "default": "0"
  },
  {
    "name": "OldStereoMode",
    "id": "0x53b9",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\OldStereoMode",
    "default": null
  },
  {
    "name": "PixelWidth",
    "id": "0xb0",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\PixelWidth",
    "default": null
  },
  {
    "name": "PixelHeight",
    "id": "0xba",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\PixelHeight",
    "default": null
  },
  {
    "name": "PixelCropBottom",
    "id": "0x54aa",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\PixelCropBottom",
    "default": "0"
  },
  {
    "name": "PixelCropTop",
    "id": "0x54bb",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\PixelCropTop",
    "default": "0"
  },
  {
    "name": "PixelCropLeft",
    "id": "0x54cc",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\PixelCropLeft",
    "default": "0"
  },
  {
    "name": "PixelCropRight",
    "id": "0x54dd",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\PixelCropRight",
    "default": "0"
  },
  {
    "name": "DisplayWidth",
    "id": "0x54b0",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\DisplayWidth",
    "default": null
  },
  {
    "name": "DisplayHeight",
    "id": "0x54ba",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\DisplayHeight",
    "default": null
  },
  {
    "name": "DisplayUnit",
    "id": "0x54b2",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\DisplayUnit",
    "default": "0"
  },
  {
    "name": "AspectRatioType",
    "id": "0x54b3",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\AspectRatioType",
    "default": "0"
  },
  {
    "name": "UncompressedFourCC",
    "id": "0x2eb524",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\UncompressedFourCC",
    "default": null
  },
  {
    "name": "GammaValue",
    "id": "0x2fb523",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\GammaValue",
    "default": null
  },
  {
    "name": "FrameRate",
    "id": "0x2383e3",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\FrameRate",
    "default": null
  },
  {
    "name": "Colour",
    "id": "0x55b0",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour",
    "default": null
  },
  {
    "name": "MatrixCoefficients",
    "id": "0x55b1",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MatrixCoefficients",
    "default": "2"
  },
  {
    "name": "BitsPerChannel",
    "id": "0x55b2",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\BitsPerChannel",
    "default": "0"
  },
  {
    "name": "ChromaSubsamplingHorz",
    "id": "0x55b3",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\ChromaSubsamplingHorz",
    "default": null
  },
  {
    "name": "ChromaSubsamplingVert",
    "id": "0x55b4",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\ChromaSubsamplingVert",
    "default": null
  },
  {
    "name": "CbSubsamplingHorz",
    "id": "0x55b5",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\CbSubsamplingHorz",
    "default": null
  },
  {
    "name": "CbSubsamplingVert",
    "id": "0x55b6",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\CbSubsamplingVert",
    "default": null
  },
  {
    "name": "ChromaSitingHorz",
    "id": "0x55b7",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\ChromaSitingHorz",
    "default": "0"
  },
  {
    "name": "ChromaSitingVert",
    "id": "0x55b8",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\ChromaSitingVert",
    "default": "0"
  },
  {
    "name": "Range",
    "id": "0x55b9",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\Range",
    "default": "0"
  },
  {
    "name": "TransferCharacteristics",
    "id": "0x55ba",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\TransferCharacteristics",
    "default": "2"
  },
  {
    "name": "Primaries",
    "id": "0x55bb",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\Primaries",
    "default": "2"
  },
  {
    "name": "MaxCLL",
    "id": "0x55bc",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MaxCLL",
    "default": null
  },
  {
    "name": "MaxFALL",
    "id": "0x55bd",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MaxFALL",
    "default": null
  },
  {
    "name": "MasteringMetadata",
    "id": "0x55d0",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MasteringMetadata",
    "default": null
  },
  {
    "name": "PrimaryRChromaticityX",
    "id": "0x55d1",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MasteringMetadata\\PrimaryRChromaticityX",
    "default": null
  },
  {
    "name": "PrimaryRChromaticityY",
    "id": "0x55d2",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MasteringMetadata\\PrimaryRChromaticityY",
    "default": null
  },
  {
    "name": "PrimaryGChromaticityX",
    "id": "0x55d3",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MasteringMetadata\\PrimaryGChromaticityX",
    "default": null
  },
  {
    "name": "PrimaryGChromaticityY",
    "id": "0x55d4",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MasteringMetadata\\PrimaryGChromaticityY",
    "default": null
  },
  {
    "name": "PrimaryBChromaticityX",
    "id": "0x55d5",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MasteringMetadata\\PrimaryBChromaticityX",
    "default": null
  },
  {
    "name": "PrimaryBChromaticityY",
    "id": "0x55d6",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MasteringMetadata\\PrimaryBChromaticityY",
    "default": null
  },
  {
    "name": "WhitePointChromaticityX",
    "id": "0x55d7",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MasteringMetadata\\WhitePointChromaticityX",
    "default": null
  },
  {
    "name": "WhitePointChromaticityY",
    "id": "0x55d8",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MasteringMetadata\\WhitePointChromaticityY",
    "default": null
  },
  {
    "name": "LuminanceMax",
    "id": "0x55d9",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MasteringMetadata\\LuminanceMax",
    "default": null
  },
  {
    "name": "LuminanceMin",
    "id": "0x55da",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Colour\\MasteringMetadata\\LuminanceMin",
    "default": null
  },
  {
    "name": "Projection",
    "id": "0x7670",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Projection",
    "default": null
  },
  {
    "name": "ProjectionType",
    "id": "0x7671",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Projection\\ProjectionType",
    "default": "0"
  },
  {
    "name": "ProjectionPrivate",
    "id": "0x7672",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Projection\\ProjectionPrivate",
    "default": null
  },
  {
    "name": "ProjectionPoseYaw",
    "id": "0x7673",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Projection\\ProjectionPoseYaw",
    "default": "0x0p+0"
  },
  {
    "name": "ProjectionPosePitch",
    "id": "0x7674",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Projection\\ProjectionPosePitch",
    "default": "0x0p+0"
  },
  {
    "name": "ProjectionPoseRoll",
    "id": "0x7675",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Video\\Projection\\ProjectionPoseRoll",
    "default": "0x0p+0"
  },
  {
    "name": "Audio",
    "id": "0xe1",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\Audio",
    "default": null
  },
  {
    "name": "SamplingFrequency",
    "id": "0xb5",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Audio\\SamplingFrequency",
    "default": "0x1.f4p+12"
  },
  {
    "name": "OutputSamplingFrequency",
    "id": "0x78b5",
    "type": "float",
    "path": "\\Segment\\Tracks\\TrackEntry\\Audio\\OutputSamplingFrequency",
    "default": null
  },
  {
    "name": "Channels",
    "id": "0x9f",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Audio\\Channels",
    "default": "1"
  },
  {
    "name": "ChannelPositions",
    "id": "0x7d7b",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\Audio\\ChannelPositions",
    "default": null
  },
  {
    "name": "BitDepth",
    "id": "0x6264",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Audio\\BitDepth",
    "default": null
  },
  {
    "name": "Emphasis",
    "id": "0x52f1",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\Audio\\Emphasis",
    "default": "0"
  },
  {
    "name": "TrackOperation",
    "id": "0xe2",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackOperation",
    "default": null
  },
  {
    "name": "TrackCombinePlanes",
    "id": "0xe3",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackOperation\\TrackCombinePlanes",
    "default": null
  },
  {
    "name": "TrackPlane",
    "id": "0xe4",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackOperation\\TrackCombinePlanes\\TrackPlane",
    "default": null
  },
  {
    "name": "TrackPlaneUID",
    "id": "0xe5",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackOperation\\TrackCombinePlanes\\TrackPlane\\TrackPlaneUID",
    "default": null
  },
  {
    "name": "TrackPlaneType",
    "id": "0xe6",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackOperation\\TrackCombinePlanes\\TrackPlane\\TrackPlaneType",
    "default": null
  },
  {
    "name": "TrackJoinBlocks",
    "id": "0xe9",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackOperation\\TrackJoinBlocks",
    "default": null
  },
  {
    "name": "TrackJoinUID",
    "id": "0xed",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrackOperation\\TrackJoinBlocks\\TrackJoinUID",
    "default": null
  },
  {
    "name": "TrickTrackUID",
    "id": "0xc0",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrickTrackUID",
    "default": null
  },
  {
    "name": "TrickTrackSegmentUID",
    "id": "0xc1",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrickTrackSegmentUID",
    "default": null
  },
  {
    "name": "TrickTrackFlag",
    "id": "0xc6",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrickTrackFlag",
    "default": "0"
  },
  {
    "name": "TrickMasterTrackUID",
    "id": "0xc7",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrickMasterTrackUID",
    "default": null
  },
  {
    "name": "TrickMasterTrackSegmentUID",
    "id": "0xc4",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\TrickMasterTrackSegmentUID",
    "default": null
  },
  {
    "name": "ContentEncodings",
    "id": "0x6d80",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings",
    "default": null
  },
  {
    "name": "ContentEncoding",
    "id": "0x6240",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding",
    "default": null
  },
  {
    "name": "ContentEncodingOrder",
    "id": "0x5031",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncodingOrder",
    "default": "0"
  },
  {
    "name": "ContentEncodingScope",
    "id": "0x5032",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncodingScope",
    "default": "1"
  },
  {
    "name": "ContentEncodingType",
    "id": "0x5033",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncodingType",
    "default": "0"
  },
  {
    "name": "ContentCompression",
    "id": "0x5034",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentCompression",
    "default": null
  },
  {
    "name": "ContentCompAlgo",
    "id": "0x4254",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentCompression\\ContentCompAlgo",
    "default": "0"
  },
  {
    "name": "ContentCompSettings",
    "id": "0x4255",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentCompression\\ContentCompSettings",
    "default": null
  },
  {
    "name": "ContentEncryption",
    "id": "0x5035",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncryption",
    "default": null
  },
  {
    "name": "ContentEncAlgo",
    "id": "0x47e1",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncryption\\ContentEncAlgo",
    "default": "0"
  },
  {
    "name": "ContentEncKeyID",
    "id": "0x47e2",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncryption\\ContentEncKeyID",
    "default": null
  },
  {
    "name": "ContentEncAESSettings",
    "id": "0x47e7",
    "type": "master",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncryption\\ContentEncAESSettings",
    "default": null
  },
  {
    "name": "AESSettingsCipherMode",
    "id": "0x47e8",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncryption\\ContentEncAESSettings\\AESSettingsCipherMode",
    "default": null
  },
  {
    "name": "ContentSignature",
    "id": "0x47e3",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncryption\\ContentSignature",
    "default": null
  },
  {
    "name": "ContentSigKeyID",
    "id": "0x47e4",
    "type": "binary",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncryption\\ContentSigKeyID",
    "default": null
  },
  {
    "name": "ContentSigAlgo",
    "id": "0x47e5",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncryption\\ContentSigAlgo",
    "default": "0"
  },
  {
    "name": "ContentSigHashAlgo",
    "id": "0x47e6",
    "type": "uinteger",
    "path": "\\Segment\\Tracks\\TrackEntry\\ContentEncodings\\ContentEncoding\\ContentEncryption\\ContentSigHashAlgo",
    "default": "0"
  },
  {
    "name": "Cues",
    "id": "0x1c53bb6b",
    "type": "master",
    "path": "\\Segment\\Cues",
    "default": null
  },
  {
    "name": "CuePoint",
    "id": "0xbb",
    "type": "master",
    "path": "\\Segment\\Cues\\CuePoint",
    "default": null
  },
  {
    "name": "CueTime",
    "id": "0xb3",
    "type": "uinteger",
    "path": "\\Segment\\Cues\\CuePoint\\CueTime",
    "default": null
  },
  {
    "name": "CueTrackPositions",
    "id": "0xb7",
    "type": "master",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions",
    "default": null
  },
  {
    "name": "CueTrack",
    "id": "0xf7",
    "type": "uinteger",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions\\CueTrack",
    "default": null
  },
  {
    "name": "CueClusterPosition",
    "id": "0xf1",
    "type": "uinteger",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions\\CueClusterPosition",
    "default": null
  },
  {
    "name": "CueRelativePosition",
    "id": "0xf0",
    "type": "uinteger",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions\\CueRelativePosition",
    "default": null
  },
  {
    "name": "CueDuration",
    "id": "0xb2",
    "type": "uinteger",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions\\CueDuration",
    "default": null
  },
  {
    "name": "CueBlockNumber",
    "id": "0x5378",
    "type": "uinteger",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions\\CueBlockNumber",
    "default": null
  },
  {
    "name": "CueCodecState",
    "id": "0xea",
    "type": "uinteger",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions\\CueCodecState",
    "default": "0"
  },
  {
    "name": "CueReference",
    "id": "0xdb",
    "type": "master",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions\\CueReference",
    "default": null
  },
  {
    "name": "CueRefTime",
    "id": "0x96",
    "type": "uinteger",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions\\CueReference\\CueRefTime",
    "default": null
  },
  {
    "name": "CueRefCluster",
    "id": "0x97",
    "type": "uinteger",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions\\CueReference\\CueRefCluster",
    "default": null
  },
  {
    "name": "CueRefNumber",
    "id": "0x535f",
    "type": "uinteger",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions\\CueReference\\CueRefNumber",
    "default": "1"
  },
  {
    "name": "CueRefCodecState",
    "id": "0xeb",
    "type": "uinteger",
    "path": "\\Segment\\Cues\\CuePoint\\CueTrackPositions\\CueReference\\CueRefCodecState",
    "default": "0"
  },
  {
    "name": "Attachments",
    "id": "0x1941a469",
    "type": "master",
    "path": "\\Segment\\Attachments",
    "default": null
  },
  {
    "name": "AttachedFile",
    "id": "0x61a7",
    "type": "master",
    "path": "\\Segment\\Attachments\\AttachedFile",
    "default": null
  },
  {
    "name": "FileDescription",
    "id": "0x467e",
    "type": "utf-8",
    "path": "\\Segment\\Attachments\\AttachedFile\\FileDescription",
    "default": null
  },
  {
    "name": "FileName",
    "id": "0x466e",
    "type": "utf-8",
    "path": "\\Segment\\Attachments\\AttachedFile\\FileName",
    "default": null
  },
  {
    "name": "FileMediaType",
    "id": "0x4660",
    "type": "string",
    "path": "\\Segment\\Attachments\\AttachedFile\\FileMediaType",
    "default": null
  },
  {
    "name": "FileData",
    "id": "0x465c",
    "type": "binary",
    "path": "\\Segment\\Attachments\\AttachedFile\\FileData",
    "default": null
  },
  {
    "name": "FileUID",
    "id": "0x46ae",
    "type": "uinteger",
    "path": "\\Segment\\Attachments\\AttachedFile\\FileUID",
    "default": null
  },
  {
    "name": "FileReferral",
    "id": "0x4675",
    "type": "binary",
    "path": "\\Segment\\Attachments\\AttachedFile\\FileReferral",
    "default": null
  },
  {
    "name": "FileUsedStartTime",
    "id": "0x4661",
    "type": "uinteger",
    "path": "\\Segment\\Attachments\\AttachedFile\\FileUsedStartTime",
    "default": null
  },
  {
    "name": "FileUsedEndTime",
    "id": "0x4662",
    "type": "uinteger",
    "path": "\\Segment\\Attachments\\AttachedFile\\FileUsedEndTime",
    "default": null
  },
  {
    "name": "Chapters",
    "id": "0x1043a770",
    "type": "master",
    "path": "\\Segment\\Chapters",
    "default": null
  },
  {
    "name": "EditionEntry",
    "id": "0x45b9",
    "type": "master",
    "path": "\\Segment\\Chapters\\EditionEntry",
    "default": null
  },
  {
    "name": "EditionUID",
    "id": "0x45bc",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\EditionUID",
    "default": null
  },
  {
    "name": "EditionFlagHidden",
    "id": "0x45bd",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\EditionFlagHidden",
    "default": "0"
  },
  {
    "name": "EditionFlagDefault",
    "id": "0x45db",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\EditionFlagDefault",
    "default": "0"
  },
  {
    "name": "EditionFlagOrdered",
    "id": "0x45dd",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\EditionFlagOrdered",
    "default": "0"
  },
  {
    "name": "EditionDisplay",
    "id": "0x4520",
    "type": "master",
    "path": "\\Segment\\Chapters\\EditionEntry\\EditionDisplay",
    "default": null
  },
  {
    "name": "EditionString",
    "id": "0x4521",
    "type": "utf-8",
    "path": "\\Segment\\Chapters\\EditionEntry\\EditionDisplay\\EditionString",
    "default": null
  },
  {
    "name": "EditionLanguageIETF",
    "id": "0x45e4",
    "type": "string",
    "path": "\\Segment\\Chapters\\EditionEntry\\EditionDisplay\\EditionLanguageIETF",
    "default": null
  },
  {
    "name": "ChapterAtom",
    "id": "0xb6",
    "type": "master",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom",
    "default": null
  },
  {
    "name": "ChapterUID",
    "id": "0x73c4",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterUID",
    "default": null
  },
  {
    "name": "ChapterStringUID",
    "id": "0x5654",
    "type": "utf-8",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterStringUID",
    "default": null
  },
  {
    "name": "ChapterTimeStart",
    "id": "0x91",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterTimeStart",
    "default": null
  },
  {
    "name": "ChapterTimeEnd",
    "id": "0x92",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterTimeEnd",
    "default": null
  },
  {
    "name": "ChapterFlagHidden",
    "id": "0x98",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterFlagHidden",
    "default": "0"
  },
  {
    "name": "ChapterFlagEnabled",
    "id": "0x4598",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterFlagEnabled",
    "default": "1"
  },
  {
    "name": "ChapterSegmentUUID",
    "id": "0x6e67",
    "type": "binary",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterSegmentUUID",
    "default": null
  },
  {
    "name": "ChapterSkipType",
    "id": "0x4588",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterSkipType",
    "default": null
  },
  {
    "name": "ChapterSegmentEditionUID",
    "id": "0x6ebc",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterSegmentEditionUID",
    "default": null
  },
  {
    "name": "ChapterPhysicalEquiv",
    "id": "0x63c3",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterPhysicalEquiv",
    "default": null
  },
  {
    "name": "ChapterTrack",
    "id": "0x8f",
    "type": "master",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterTrack",
    "default": null
  },
  {
    "name": "ChapterTrackUID",
    "id": "0x89",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterTrack\\ChapterTrackUID",
    "default": null
  },
  {
    "name": "ChapterDisplay",
    "id": "0x80",
    "type": "master",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterDisplay",
    "default": null
  },
  {
    "name": "ChapString",
    "id": "0x85",
    "type": "utf-8",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterDisplay\\ChapString",
    "default": null
  },
  {
    "name": "ChapLanguage",
    "id": "0x437c",
    "type": "string",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterDisplay\\ChapLanguage",
    "default": "eng"
  },
  {
    "name": "ChapLanguageBCP47",
    "id": "0x437d",
    "type": "string",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterDisplay\\ChapLanguageBCP47",
    "default": null
  },
  {
    "name": "ChapCountry",
    "id": "0x437e",
    "type": "string",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapterDisplay\\ChapCountry",
    "default": null
  },
  {
    "name": "ChapProcess",
    "id": "0x6944",
    "type": "master",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapProcess",
    "default": null
  },
  {
    "name": "ChapProcessCodecID",
    "id": "0x6955",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapProcess\\ChapProcessCodecID",
    "default": "0"
  },
  {
    "name": "ChapProcessPrivate",
    "id": "0x450d",
    "type": "binary",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapProcess\\ChapProcessPrivate",
    "default": null
  },
  {
    "name": "ChapProcessCommand",
    "id": "0x6911",
    "type": "master",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapProcess\\ChapProcessCommand",
    "default": null
  },
  {
    "name": "ChapProcessTime",
    "id": "0x6922",
    "type": "uinteger",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapProcess\\ChapProcessCommand\\ChapProcessTime",
    "default": null
  },
  {
    "name": "ChapProcessData",
    "id": "0x6933",
    "type": "binary",
    "path": "\\Segment\\Chapters\\EditionEntry\\+ChapterAtom\\ChapProcess\\ChapProcessCommand\\ChapProcessData",
    "default": null
  },
  {
    "name": "Tags",
    "id": "0x1254c367",
    "type": "master",
    "path": "\\Segment\\Tags",
    "default": null
  },
  {
    "name": "Tag",
    "id": "0x7373",
    "type": "master",
    "path": "\\Segment\\Tags\\Tag",
    "default": null
  },
  {
    "name": "Targets",
    "id": "0x63c0",
    "type": "master",
    "path": "\\Segment\\Tags\\Tag\\Targets",
    "default": null
  },
  {
    "name": "TargetTypeValue",
    "id": "0x68ca",
    "type": "uinteger",
    "path": "\\Segment\\Tags\\Tag\\Targets\\TargetTypeValue",
    "default": "50"
  },
  {
    "name": "TargetType",
    "id": "0x63ca",
    "type": "string",
    "path": "\\Segment\\Tags\\Tag\\Targets\\TargetType",
    "default": null
  },
  {
    "name": "TagTrackUID",
    "id": "0x63c5",
    "type": "uinteger",
    "path": "\\Segment\\Tags\\Tag\\Targets\\TagTrackUID",
    "default": "0"
  },
  {
    "name": "TagEditionUID",
    "id": "0x63c9",
    "type": "uinteger",
    "path": "\\Segment\\Tags\\Tag\\Targets\\TagEditionUID",
    "default": "0"
  },
  {
    "name": "TagChapterUID",
    "id": "0x63c4",
    "type": "uinteger",
    "path": "\\Segment\\Tags\\Tag\\Targets\\TagChapterUID",
    "default": "0"
  },
  {
    "name": "TagAttachmentUID",
    "id": "0x63c6",
    "type": "uinteger",
    "path": "\\Segment\\Tags\\Tag\\Targets\\TagAttachmentUID",
    "default": "0"
  },
  {
    "name": "TagBlockAddIDValue",
    "id": "0x63c7",
    "type": "uinteger",
    "path": "\\Segment\\Tags\\Tag\\Targets\\TagBlockAddIDValue",
    "default": "0"
  },
  {
    "name": "SimpleTag",
    "id": "0x67c8",
    "type": "master",
    "path": "\\Segment\\Tags\\Tag\\+SimpleTag",
    "default": null
  },
  {
    "name": "TagName",
    "id": "0x45a3",
    "type": "utf-8",
    "path": "\\Segment\\Tags\\Tag\\+SimpleTag\\TagName",
    "default": null
  },
  {
    "name": "TagLanguage",
    "id": "0x447a",
    "type": "string",
    "path": "\\Segment\\Tags\\Tag\\+SimpleTag\\TagLanguage",
    "default": "und"
  },
  {
    "name": "TagLanguageBCP47",
    "id": "0x447b",
    "type": "string",
    "path": "\\Segment\\Tags\\Tag\\+SimpleTag\\TagLanguageBCP47",
    "default": null
  },
  {
    "name": "TagDefault",
    "id": "0x4484",
    "type": "uinteger",
    "path": "\\Segment\\Tags\\Tag\\+SimpleTag\\TagDefault",
    "default": "1"
  },
  {
    "name": "TagDefaultBogus",
    "id": "0x44b4",
    "type": "uinteger",
    "path": "\\Segment\\Tags\\Tag\\+SimpleTag\\TagDefaultBogus",
    "default": "1"
  },
  {
    "name": "TagString",
    "id": "0x4487",
    "type": "utf-8",
    "path": "\\Segment\\Tags\\Tag\\+SimpleTag\\TagString",
    "default": null
  },
  {
    "name": "TagBinary",
    "id": "0x4485",
    "type": "binary",
    "path": "\\Segment\\Tags\\Tag\\+SimpleTag\\TagBinary",
    "default": null
  }
];
// Reviewed against QTFF movie/track/media/sample atom families, ISO/IEC
// 14496-12 box registry, the complete Matroska v4 element schema above, and
// ETSI EN 300 468 descriptor families. A covered row names its proof; it is
// never a fallback for an unknown field. Unknown types fail closed.
const SOURCES=Object.freeze({qt:'https://developer.apple.com/documentation/quicktime-file-format',
  iso:'https://mp4ra.org/registered-types/boxes',mkv:'https://www.matroska.org/technical/elements.html',
  ts:'https://www.etsi.org/deliver/etsi_en/300400_300499/300468/01.19.01_60/en_300468v011901p.pdf'});
const rows=[];
function row(container,field,treatment,reason,check,selector={}){rows.push({id:container+':'+field,container,field,treatment,reason,check,
  code:treatment==='require-default'||treatment==='compare'?'REMUX_NATIVE_'+field.replace(/[^a-z0-9]/gi,'_').toUpperCase().slice(0,70):null,...selector});}
const coveredISO={
  'mvhd.rate,volume,matrix':'observeRemuxEditLists: exact unity rate/volume/identity matrix',
  'mvhd.timescale,duration':'observeRemuxEditLists: exact movie/track presentation reconciliation',
  'tkhd.flags,layer,volume,matrix,width,height':'observeRemuxEditLists: target controls and exact display geometry',
  'tkhd.duration':'observeRemuxEditLists: exact source/output duration semantics',
  'edts,elst':'observeRemuxEditLists: unity rates, exact media_time/span/delay; unsupported repeated preroll refuses',
  'mdhd.timescale,duration':'observeRemuxEditLists: exact media decode duration',
  'mdhd.language':'observeMovRepresentation + exact stream language metadata comparison',
  'smhd.balance':'observeRemuxEditLists: exact zero balance',
  'tapt,clef,prof,enof':'observeRemuxEditLists: every mode equals native display geometry',
  'stts,ctts,stsz,stz2,stsc,stco,co64,stss':'complete packet identity: exact clocks, payload/size/count/key flags; native timing run checks',
  'avcC,hvcC,av1C,vpcC,esds,glbl,dfLa,dOps,dac3,dec3,alac':'codecParameters/H264 admission + complete coded-header identity',
  'pasp,colr,fiel':'exact codec/probe geometry, field order and colour; ICC/presentation extensions separately guarded',
  'trex,tfhd,tfdt,trun,mfhd,mehd':'fragmentCoverage + full packet identity: defaults, description, continuous clocks and samples',
  'chan':'exact channel layout/sample rate/native AAC configuration and PCM/effective-trim comparison',
};
for(const [fields,proof]of Object.entries(coveredISO)){const parts=fields.split(','),prefix=parts[0].includes('.')?parts[0].split('.')[0]+'.':'';
  for(const part of parts){const field=prefix&&!part.includes('.')?prefix+part:part;row('isobmff',field,'covered','Existing exact media proof.',proof,{atom:field.split('.')[0]});}}
for(const [field,offset]of [['preview_time',72],['preview_duration',76],['poster_time',80],['selection_time',84],['selection_duration',88],['current_time',92]])
  row('isobmff','mvhd.'+field,'require-default','A saved movie playback/selection position is not carried by the muxer.','uint-zero',{atom:'mvhd',offset,versionShift:12,width:4});
row('isobmff','vmhd.graphics_mode','require-default','Only ordinary copy/transparent video composition is admitted; blending is not carried.','vmhd-mode',{atom:'vmhd',offset:4,width:2});
row('isobmff','vmhd.opcolor','require-default','Blend operand colours must be zero.','bytes-zero',{atom:'vmhd',offset:6,width:6});
row('isobmff','tkhd.alternate_group','compare','Group numbers are labels; compare the membership partition, with singleton groups equivalent to no group.','groups',{atom:'tkhd'});
row('isobmff','hdlr.handler','compare','The native media handler must agree with the admitted stream kind.','handler',{atom:'hdlr'});
row('isobmff','hdlr.component_flags','require-default','Custom handler flags/masks are not carried.','bytes-zero',{atom:'hdlr',offset:16,width:8});
row('isobmff','elng','compare','Extended language is authoritative and must equal the language the muxer can carry.','iso-language',{atom:'elng'});
row('isobmff','clap','require-default','Only the complete coded picture with zero aperture offsets is supported.','clean-aperture',{atom:'clap'});
row('isobmff','colr.profile','require-default','Only explicit nclc/nclx colour descriptions are implemented; ICC profiles need a separate proof.','colour-method',{atom:'colr'});
row('isobmff','sgpd','require-default','Only the AAC-LC implicit one-frame roll group is admitted.','aac-groups',{atom:'sgpd'});
row('isobmff','sbgp','require-default','Only the complete AAC-LC roll mapping is admitted.','aac-groups',{atom:'sbgp'});
for(const atom of ['txas','load','imap','clip','crgn','matt','kmat','tref','trgr','tsel','kind','stps','sdtp','cslg','gama','st3d','sv3d','sinf','schi','schm','tenc','senc','saiz','saio','pssh','subs','padb','stdp','csgp','dsgd','dstg','dref.external','rmra','rmda','rdrf','rmvc','rmcd','rmdr','rmqu','play','LOOP','SelO','AllF','WLOC','ptv ','hint','hnti','hinf','gmhd','tmcd','tcmi','iods','iprp','ipco','ipma','iref','pitm','iloc','iinf','idat','cmov','pnot','uuid'])
  row('isobmff',atom,'require-default','This native presentation, dependency, reference, encryption, interaction or external-resource control has no equivalent verified target representation.',atom==='dref.external'?'self-reference':'absent',{atom:atom.split('.')[0]});
for(const kind of ['hint','cdsc','chap','sync','tmcd','scpt','ssrc','font','dpnd','ipir','mpod','vdep','vplx','subt','auxl','thmb','prem','forc','folw'])
  row('isobmff','tref.'+kind,'covered','Track-reference descendants cannot occur on an admitted copied track.','parent-presence:tref',{atom:kind});
for(const key of ['com.apple.quicktime.video-orientation','com.apple.quicktime.video-orientation-quaternion','com.apple.quicktime.camera.framereadout','com.apple.quicktime.projection.kind','com.apple.quicktime.stereo-mode','replaygain_track_gain','replaygain_album_gain','iTunSMPB'])
  row('isobmff','meta.'+key,'require-default','Functional metadata keys need an exact native target mapping.','metadata-key',{key});
const isoStructure=['ftyp','mdat','moov','trak','mdia','minf','nmhd','stbl','stsd','dinf','dref','meta','ilst','keys','data','udta','chpl','mvex','moof','traf','mfra','tfra','mfro','sidx','ssix','prft','url ','urn ','avc1','avc3','hvc1','hev1','av01','vp09','mp4v','mp4a','tx3g','wave','frma','\u0000\u0000\u0000\u0000'];
for(const atom of isoStructure)if(!rows.some(r=>r.container==='isobmff'&&r.field===atom))row('isobmff',atom,'covered','Container framing, media locator or codec envelope; data are independently bound by complete packet identity.','native-structure',{atom});
for(const atom of ['free','skip','wide','btrt','©too','©swr','©nam','©ART','©alb','©day','©cmt','©gen','©cpy','©wrt','©enc','©xyz','©des','©inf','©mak','©mod','©snm','©hst','name','cprt','loci','titl','auth','dscp','perf','gnre','yrrc'])
  row('isobmff',atom,'descriptive','Padding, attribution, naming/location or advisory bitrate does not select or transform media.','descriptive',{atom});
const mkvCovered=new Set(('TimestampScale Duration TrackNumber TrackUID TrackType CodecID CodecPrivate CodecDelay DefaultDuration PixelWidth PixelHeight FlagInterlaced FieldOrder SamplingFrequency OutputSamplingFrequency Channels BitDepth ChannelPositions MatrixCoefficients BitsPerChannel ChromaSubsamplingHorz ChromaSubsamplingVert CbSubsamplingHorz CbSubsamplingVert ChromaSitingHorz ChromaSitingVert Range TransferCharacteristics Primaries TrackName Name Language ChapterTimeStart ChapterTimeEnd ChapterString ChapLanguage TagName TagLanguage TagString TagBinary TargetTypeValue TagTrackUID TagChapterUID TagAttachmentUID TagDefault Attachments AttachedFile FileName FileMediaType FileData FileUID'.split(' ')));
const mkvDescriptive=new Set('SegmentUUID SegmentFilename DateUTC Title MuxingApp WritingApp CRC-32 Void SeekID SeekPosition CueTime CueTrack CueClusterPosition CueRelativePosition CueDuration CueBlockNumber CueCodecState CueRefTime CueRefCluster CueRefNumber CueRefCodecState Position PrevSize FileDescription TagLanguageIETF'.split(' '));
const mkvDefaults={FlagEnabled:1,TrackTimestampScale:1,TrackOffset:0,SeekPreRoll:0,PixelCropBottom:0,PixelCropTop:0,PixelCropLeft:0,PixelCropRight:0,DisplayUnit:0,AspectRatioType:0,StereoMode:0,AlphaMode:0,AudioEmphasis:0,MaxBlockAdditionID:0,EditionFlagHidden:0,EditionFlagOrdered:0,ChapterFlagHidden:0,ChapterFlagEnabled:1};
const mkvCompare={FlagDefault:'disposition-default',FlagForced:'disposition-forced',FlagHearingImpaired:'disposition-hearing_impaired',FlagVisualImpaired:'disposition-visual_impaired',FlagTextDescriptions:'disposition-descriptions',FlagOriginal:'disposition-original',FlagCommentary:'disposition-comment',LanguageBCP47:'language',DisplayWidth:'display',DisplayHeight:'display',EditionFlagDefault:'single-edition'};
const mkvAbsent=new Set('PrevUUID PrevFilename NextUUID NextFilename SegmentFamily ChapterTranslate TrackOperation ContentEncodings BlockAdditionMapping Projection MasteringMetadata MaxCLL MaxFALL TrackTranslate TrackOverlay CodecSettings CodecInfoURL CodecDownloadURL AttachmentLink EditionDisplay ChapterSegmentUUID ChapterSkipType ChapterSegmentEditionUID ChapProcess ChapterTrack ChapterPhysicalEquiv TrickTrackUID TrickTrackSegmentUID TrickTrackFlag TrickMasterTrackUID TrickMasterTrackSegmentUID CodecDecodeAll TrackPlaneUID'.split(' '));
mkvCovered.add('EBMLMaxIDLength');mkvCovered.add('EBMLMaxSizeLength');
for(const e of MATROSKA_SCHEMA){let treatment,check,reason;
  if(Object.hasOwn(mkvDefaults,e.name)){treatment='require-default';check='mkv-default';reason='Only the neutral native value is represented by all admitted targets.';}
  else if(Object.hasOwn(mkvCompare,e.name)){treatment='compare';check=mkvCompare[e.name];reason='Read the native value and require the same effective selection/presentation meaning.';}
  else if(mkvAbsent.has(e.name)){treatment='require-default';check='absent';reason='This linking, processing, encryption, projection, HDR or alternate-presentation extension is not carried.';}
  else if(mkvDescriptive.has(e.name)){treatment='descriptive';check='descriptive';reason='Indexing, integrity, identification or naming does not transform or select media.';}
  else if(mkvCovered.has(e.name)){treatment='covered';check=/File/.test(e.name)?'complete attachment payload/header identity':'exact packet/codec/metadata/chapter comparison';reason='Already included in the complete bound media/metadata proof.';}
  else if(e.type==='master'){treatment='covered';check='native-structure';reason='Container only; every child has its own inventory row.';}
  else if(e.path.includes('\\Cluster\\')){treatment='covered';check='complete all-packet timing/key/size/side-data identity';reason='Cluster payload is never re-read here; complete demuxed packet evidence binds its presentation effects.';}
  else{treatment='require-default';check='absent';reason='No equivalent target representation has been established for this element.';}
  row('matroska',e.name,treatment,reason,check,{element:e.id,type:e.type,nativeDefault:Object.hasOwn(mkvDefaults,e.name)?mkvDefaults[e.name]:e.default});
}
for(const [name,id,type]of [['EBML','0x1a45dfa3','master'],['EBMLVersion','0x4286','uinteger'],['EBMLReadVersion','0x42f7','uinteger'],['EBMLMaxIDLength','0x42f2','uinteger'],['EBMLMaxSizeLength','0x42f3','uinteger'],['DocType','0x4282','string'],['DocTypeVersion','0x4287','uinteger'],['DocTypeReadVersion','0x4285','uinteger'],['CRC-32','0xbf','binary'],['Void','0xec','binary']]){
  if(!MATROSKA_SCHEMA.some(e=>e.id===id))MATROSKA_SCHEMA.push({name,id,type,path:'\\EBML\\'+name,default:null});
  if(!rows.some(r=>r.id==='matroska:'+name))row('matroska',name,'covered','Bounded EBML framing/version negotiation; CRC/index padding cannot select media.','native-structure',{element:id,type});
}
for(const e of MATROSKA_SCHEMA)if(['EBMLVersion','EBMLReadVersion','DocTypeVersion','DocTypeReadVersion'].includes(e.name))e.default='1';
row('matroska','FlagLacing','descriptive','Permits a block packing representation; the complete demuxed packet sequence is unchanged.','descriptive',{element:'0x9c'});
// Remove the schema-generated FlagLacing absence rule in favour of its packing
// semantics. This does not exempt any other element from classification.
rows.splice(rows.findIndex(r=>r.id==='matroska:FlagLacing'),1);
for(const [field,check]of Object.entries({PAT:'one exact program',PMT:'stable exact program and elementary stream map',PCR:'monotonic base/extension and PES distance',PTS_DTS:'native non-wrapping clocks and exact rational packet identity',ADTS:'constant AAC-LC configuration and raw-frame payload identity',AVC:'whole NAL/SPS/PPS/slice admission'}))
  row('mpegts',field,'covered','Existing transport preparation binds this field before Ready and on the final output.',check);
for(const [tag,field]of [[2,'video_stream'],[3,'audio_stream'],[5,'registration'],[6,'data_stream_alignment'],[9,'conditional_access'],[10,'ISO_639_language_audio_type'],[11,'system_clock'],[14,'maximum_bitrate'],[27,'MPEG4_video'],[28,'MPEG4_audio'],[40,'AVC_video'],[42,'AVC_timing_HRD'],[48,'HEVC_video'],[80,'component'],[86,'teletext'],[89,'subtitling'],[106,'AC3'],[122,'enhanced_AC3'],[124,'AAC'],[127,'extension_accessibility_audio_preselection']])
  row('mpegts','descriptor.'+field,'require-default','Presentation/selection descriptors require an explicit target mapping; unknown/private descriptor tags also refuse.','ts-descriptor',{tag});
// Ordinary-file controls are comparisons, never blanket presence refusals.
// A differing output fails publication; an input with a readable ordinary
// colour/aperture/timing field is not excluded merely for carrying the field.
for(const r of rows){
  if(r.container==='isobmff'&&['clap','colr.profile','sgpd','sbgp','gama','sdtp','stps','cslg'].includes(r.field)){
    r.treatment='compare';r.reason='Compare the effective native presentation/dependency value; absent redundant defaults are equivalent.';
    if(['gama','sdtp','stps','cslg'].includes(r.field))r.check='fingerprint';
  }
  if(r.container==='isobmff'&&['pasp','fiel'].includes(r.field)){
    r.treatment='compare';r.check=r.field==='pasp'?'pixel-aspect':'field-order';r.code='REMUX_NATIVE_'+r.field.toUpperCase();
    r.reason='Read the native sample-entry value and corroborate the admitted codec geometry/field order; the existing exact cross-target parameter comparison binds the equivalent output.';
  }
  if(r.container==='isobmff'&&r.field.startsWith('meta.')){r.treatment='compare';r.reason='Compare native functional metadata values when present; do not refuse ordinary metadata by presence.';}
  if(r.container==='isobmff'&&['tref','uuid','kind','st3d','sv3d'].includes(r.field)){r.treatment='compare';r.check=r.field==='tref'?'references':'fingerprint';r.reason='Native optional presentation controls are compared, never rejected merely for being present.';}
  if(r.container==='isobmff'&&r.field.startsWith('tref.')){r.check='native canonical track-reference membership';r.reason='The parent tref comparison binds referenced track membership after stream mapping.';}
  if(r.container==='matroska'&&['TrackTimestampScale','DefaultDecodedFieldDuration','CodecDelay','DefaultDuration'].includes(r.field)){
    r.treatment='covered';r.check='complete exact-rational packet/sample timeline and effective AAC sample trim';r.reason='Container clocks/delay are converted into the complete compared sample timeline.';
  }
  if(r.container==='matroska'&&['TrackOffset','SeekPreRoll','PixelCropBottom','PixelCropTop','PixelCropLeft','PixelCropRight','DisplayUnit','AspectRatioType','StereoMode','AlphaMode','AudioEmphasis'].includes(r.field)){
    r.treatment='compare';r.check='mkv-value';r.reason='Compare the native effective value, with the specification default when absent.';
  }
  if(r.container==='matroska'&&['MinCache','MaxCache','CodecName','CodecSettings','FrameRate','EditionDisplay'].includes(r.field)){
    r.treatment='descriptive';r.check='advisory-only';r.reason='Decoder-cache hints, human-readable codec/edition labels and average-rate advice do not replace actual packet clocks or codec parameters.';
  }
  if(r.container==='matroska'&&['OldStereoMode','UncompressedFourCC','GammaValue','Emphasis'].includes(r.field)){
    r.treatment='compare';r.check=r.type==='binary'?'fingerprint':'mkv-value';r.reason='Ordinary/legacy presentation fields are compared natively, not refused by presence.';
  }
  if(r.container==='matroska'&&r.field==='EditionEntry'){
    r.treatment='compare';r.check='editions';r.reason='A single implicit/default edition is equivalent; multiple edition selections must survive.';r.code='REMUX_NATIVE_EDITIONENTRY';
  }
  if(r.container==='matroska'&&['MaxBlockAdditionID','CodecDecodeAll'].includes(r.field)){
    r.treatment='covered';r.check='complete packet payload/flags/side-data identity and whole-stream codec admission';r.reason='Actual additions/dependencies are bound by complete packet and codec evidence; a declared capacity is not a transform.';
  }
  if(r.container==='matroska'&&(r.field==='MasteringMetadata'||r.field==='MaxCLL'||r.field==='MaxFALL'||r.field.startsWith('Primary')||['WhitePointChromaticityX','WhitePointChromaticityY','LuminanceMax','LuminanceMin'].includes(r.field))){
    r.treatment='covered';r.check='SDR-only source envelope and exact colour/HDR side-data validation';r.reason='HDR expansion remains outside the admitted SDR source envelope; reported colour data stay exact.';
  }
  if(r.container==='matroska'&&r.treatment==='require-default'&&r.check==='absent'&&(/\\(?:Tags|Chapters)\\/.test(MATROSKA_SCHEMA.find(e=>e.id===r.element)?.path||''))&&!/^(?:ChapterSegment|ChapterSkip|ChapProcess|ChapterTrack|ChapterPhysical|EditionDisplay)/.test(r.field)){
    r.treatment='covered';r.check='exact chapter times/metadata and functional container/track tags';r.reason='Existing chapter/metadata validation binds the admitted flat chapter/tag representation.';
  }
  if(r.container==='mpegts'){
    r.enforcement=r.check==='ts-descriptor'?'documented-not-enforced':'existing-transport-check';
    if(r.tag===10){r.check='ts-language';r.enforcement='transport-inventory';r.treatment='compare';r.reason='One ISO 639 language, ordinary audio_type 0, exactly corroborated by the source probe and output functional metadata; no inaccessible selection semantics.';}
    else if(r.tag===124){r.check='ts-aac';r.enforcement='transport-inventory';r.treatment='compare';r.reason='AAC descriptor ordinary mono/stereo/surround modes must match the exact admitted channel count. Accessibility/mix/SAOC-DE controls and future extra information are not carried.';}
    else if([9,80,86,89,127].includes(r.tag)){r.check='ts-absent';r.enforcement='transport-inventory';r.reason='Conditional access, component/accessibility selection, teletext or subtitle controls have no verified MP4 equivalent in this H264/ADTS envelope.';}
    else if(r.enforcement==='documented-not-enforced')r.reason='Broader MPEG/DVB descriptor semantics are documented here, not enforced by this slice. Codec/framing/timing effects in the admitted single-program H264/ADTS envelope are bound by the existing whole-stream codec and exact packet checks; general broadcast presentation remains unqualified.';
  }
  if(r.treatment==='covered'||r.treatment==='descriptive')r.code=null;
}
// Fields nested in an explicitly unsupported control cannot occur on an
// admitted file. Record the actual enclosing guard instead of pretending to
// have independently decoded an unreachable field.
for(const r of rows.filter(r=>r.container==='matroska')){
  const path=MATROSKA_SCHEMA.find(e=>e.id===r.element)?.path;
  const parent=rows.find(p=>p.container==='matroska'&&p.check==='absent'&&p.treatment==='require-default'
    &&path?.startsWith((MATROSKA_SCHEMA.find(e=>e.id===p.element)?.path||'!')+'\\'));
  if(parent){r.treatment='covered';r.check='parent-presence:'+parent.id;r.reason='The enclosing '+parent.field+' control is refused on both sides before this field can affect playback.';r.code=null;}
}
// Newly enumerated pinned-demuxer boxes are explicit refusals, with no fallback
// acceptance of a known name whose playback semantics are not implemented.
for(const atom of ['stvi','----','AALP','ACLR','APRG','ARES','Cin\u008e','CoLL','DpxE','SA3D','SAND','SMI ','SmDm','adrm','amve','apvC','avss','chnl','clli','ddts','dmlp','dvc1','dvcC','dvvC','dvwC','enda','evcC','hfov','hvcE','iacb','imir','irot','ispe','jp2h','lhvC','lvcC','mdcv','pcmC','sbas','srat','strf','vexu','vvcC','wfex'])
  row('isobmff',atom,'require-default','The pinned demuxer recognizes this interpretation extension, but no target equivalence has been established.','absent',{atom});
for(const tag of [0x1d,0x1e,0x1f,0x26,0x27,0x35,0x3f,0x40,0x41,0x48,0x52,0x7b,0xb0,0xfd])
  row('mpegts','descriptor.tag_'+tag.toString(16),'require-default','This program/stream interpretation has no verified MP4 representation.','ts-absent',{tag,enforcement:'transport-inventory'});
for(const r of rows){
  if(r.container==='mpegts'&&r.tag!==undefined){
    r.enforcement='transport-inventory';
    if(!['ts-language','ts-aac'].includes(r.check))r.check='ts-absent';
    if(r.check==='ts-absent')r.reason='No equivalent target interpretation is proved; presence refuses before Ready.';
  }
  if(r.container==='isobmff'&&r.field==='vmhd.opcolor'){
    r.check='vmhd-opcolor';r.reason='Copy and dither-copy ignore operand colours. Modes that use them have no verified target composition and are refused by graphics_mode.';
  }
  if(r.container==='isobmff'&&r.field==='sdtp')r.check='sample-dependencies';
  if(r.container==='matroska'&&['ChromaSitingHorz','ChromaSitingVert'].includes(r.field)){
    r.treatment='compare';r.check='chroma-siting';r.reason='Both native coordinates must agree with an effective chroma location that the exact codec comparison carries. Partial coordinates refuse.';
  }
  if(r.container==='matroska'&&r.field==='DefaultDecodedFieldDuration'){
    r.treatment='require-default';r.check='absent';r.reason='The pinned muxer does not carry this independent decoded-field cadence declaration.';
  }
  if(r.container==='matroska'&&['EncryptedBlock','BlockVirtual','BlockAdditions'].includes(r.field)){
    r.treatment='require-default';r.check='absent';r.reason='This encrypted, virtual or additional block interpretation has no verified target representation.';
  }
  if(r.container==='matroska'&&['ChapLanguage','ChapLanguageBCP47'].includes(r.field)){
    r.treatment='require-default';r.check='chapter-language';r.reason='The pinned chapter demuxer/muxer carries only the implicit English chapter language. Other language selection cannot be proved.';
  }
  if(r.container==='matroska'&&r.field==='ChapterAtom'){
    r.treatment='require-default';r.check='flat-chapters';r.reason='Only flat chapter navigation is carried by the pinned chapter demuxer/muxer. Nested ChapterAtoms refuse.';
  }
  if(r.container==='matroska'&&r.field==='ChapterDisplay'){
    r.treatment='require-default';r.check='chapter-display';r.reason='Only one effective English chapter title is carried; redundant equal labels are equivalent, while alternatives refuse.';
  }
  if(r.container==='matroska'&&r.field==='ChapCountry'){
    r.treatment='require-default';r.check='absent';r.reason='Country-specific chapter-label selection is not carried by the pinned muxer.';
  }
  if(r.container==='isobmff'&&r.field==='mdhd.language'){
    r.treatment='compare';r.check='iso-media-language';r.reason='Read packed ISO and legacy QuickTime language codes natively and corroborate the carried effective stream language.';
  }
  if(r.treatment==='compare'||r.treatment==='require-default')r.code||='REMUX_NATIVE_'+r.field.replace(/[^a-z0-9]/gi,'_').toUpperCase().slice(0,70);
}
const controlWitnesses=new Set('mvhd.rate mvhd.volume mvhd.matrix mvhd.timescale mvhd.duration tkhd.flags tkhd.layer tkhd.volume tkhd.matrix tkhd.width tkhd.height tkhd.duration mdhd.timescale mdhd.duration smhd.balance edts elst tapt clef prof enof colr'.split(' '));
for(const r of rows)if(r.container==='isobmff'&&['ilst','keys','data'].includes(r.field)){
  r.treatment='compare';r.check='native-metadata';r.reason='Read keyed native metadata, including type and locale, and compare required values by key rather than by item order.';r.code='REMUX_NATIVE_META_VALUES';
}
row('isobmff','ilst.numeric-key-item','compare','Integer item types are a bounded index into this meta box’s declared keys table; unbound indices refuse. Values, type and locale compare exactly.','native-metadata',{atom:'mdta-item'});
for(const atom of ['svhd','proj','prhd','cbmp','equi','mshp'])row('isobmff',atom,'compare','Native projection declarations are read and compared exactly; unlisted descendants refuse.','fingerprint',{atom});
for(const r of rows)if(r.treatment==='covered'&&(r.container==='isobmff'&&(controlWitnesses.has(r.field)||r.field.startsWith('tref.'))||r.check.startsWith('parent-presence:')))
  r.witness=r.id;
// Work-12: ordinary native declarations must agree with the carried decoder
// representation. A successful probe alone cannot hide a conflicting element.
const mkvCorroborated=new Set(('EBMLMaxIDLength EBMLMaxSizeLength EBMLVersion EBMLReadVersion DocType DocTypeVersion DocTypeReadVersion TimestampScale TrackNumber TrackUID TrackType Name Language CodecID CodecPrivate FlagInterlaced FieldOrder PixelWidth PixelHeight MatrixCoefficients BitsPerChannel ChromaSubsamplingHorz ChromaSubsamplingVert CbSubsamplingHorz CbSubsamplingVert Range TransferCharacteristics Primaries SamplingFrequency OutputSamplingFrequency Channels BitDepth').split(' '));
for(const field of ['Duration','DefaultDuration','FileName','FileMediaType','FileData','FileUID'])mkvCorroborated.add(field);
const mkvNeutral={TrackTimestampScale:1,MaxBlockAdditionID:0,CodecDecodeAll:1,ReferencePriority:0};
const mkvUnsupported=new Set(('SilentTracks ReferenceVirtual CodecState Slices ReferenceFrame MaxCLL MaxFALL MasteringMetadata ChannelPositions ChapterStringUID EditionString EditionLanguageIETF').split(' '));
const mkvSemantic=new Set(('EditionUID ChapterUID ChapterTimeStart ChapterTimeEnd ChapString TargetTypeValue TagTrackUID TagEditionUID TagChapterUID TagAttachmentUID TagBlockAddIDValue TagName TagLanguage TagLanguageBCP47 TagDefault TagDefaultBogus TagString').split(' '));
mkvUnsupported.add('TargetType');mkvUnsupported.add('TagBinary');
for(const r of rows.filter(r=>r.container==='matroska')){
  if(mkvCorroborated.has(r.field)){r.treatment='compare';r.check='mkv-corroborated';r.reason='Read natively and corroborate the exact carried codec, clock, identity, language or metadata representation.';}
  if(Object.hasOwn(mkvNeutral,r.field)){r.treatment='require-default';r.check='mkv-default';r.nativeDefault=mkvNeutral[r.field];r.reason='Only this neutral independent timing/decoder declaration has a proved target interpretation.';}
  if(mkvUnsupported.has(r.field)){r.treatment='require-default';r.check='absent';r.reason='This independent playback/selection declaration has no proved equivalent in the pinned target muxer.';}
  if(mkvSemantic.has(r.field)){r.treatment='compare';r.check='mkv-semantic';r.reason='Read native identity, chapter clocks/titles and target-scoped functional tag values; require an exact carried representation or neutral selection.';}
  if(r.field==='CodecDelay'){r.treatment='compare';r.check='mkv-codec-delay';r.reason='Read integer-nanosecond delay and require the exact carried initial-padding sample count, including ordinary OBS 2112-sample priming; complete parameter/sample trim checks remain exact.';}
  if(r.field==='DiscardPadding'){r.treatment='compare';r.check='mkv-padding';r.reason='Read positive terminal AAC padding natively, require an exact sample quantization, compare native values within Matroska and join the complete effective-sample trim across containers. Interior, negative or unbound padding refuses.';}
  if(r.field==='ReferenceBlock'){r.treatment='require-default';r.check='mkv-reference';r.reason='Require the pinned muxer’s single canonical reference to the previous native block of the same track, using exact signed timestamps. Unbound, duplicate or changed references refuse.';}
  if(r.field==='CRC-32'){r.treatment='require-default';r.check='mkv-crc';r.reason='A four-byte integrity checksum carries no media selection/transform; compressed packets are independently hashed in full.';}
  if(r.field==='Void'){r.treatment='descriptive';r.check='inert-padding';r.reason='EBML Void is reserved padding; its payload is never interpreted as child elements or media.';}
  if(['compare','require-default'].includes(r.treatment))r.code||='REMUX_NATIVE_'+r.field.replace(/[^a-z0-9]/gi,'_').toUpperCase().slice(0,70);
}
// Name the actual enclosing refusal for its unreachable descendants. Each has
// a field-specific fixture; none is certified merely by this annotation.
for(const r of rows.filter(r=>r.container==='matroska')){
  const p=MATROSKA_SCHEMA.find(e=>e.id===r.element)?.path;
  const parent=rows.find(q=>q.container==='matroska'&&q.check==='absent'&&q.treatment==='require-default'&&p?.startsWith((MATROSKA_SCHEMA.find(e=>e.id===q.element)?.path||'!')+'\\'));
  if(parent){r.treatment='covered';r.check='parent-presence:'+parent.id;r.witness=r.id;r.reason='The enclosing '+parent.field+' control is refused before any descendant interpretation.';r.code=null;}
}
const isoMasters=new Set('moov trak mdia minf stbl dinf meta udta mvex moof traf mfra wave'.split(' '));
const isoNativeChecks={ftyp:'iso-ftyp',stsd:'iso-stsd',dref:'iso-dref',nmhd:'iso-zero-box','\u0000\u0000\u0000\u0000':'iso-zero-box','url ':'iso-self-entry',frma:'iso-frma',chpl:'iso-chpl',chan:'iso-chan',mfhd:'iso-index',tfra:'iso-index',mfro:'iso-index',sidx:'iso-index'};
for(const name of ['avc1','avc3','hvc1','hev1','av01','vp09','mp4v','mp4a','tx3g'])isoNativeChecks[name]='iso-sample-entry';
for(const name of ['avcC','hvcC','av1C','vpcC','esds','glbl','dfLa','dOps','dac3','dec3','alac'])isoNativeChecks[name]='iso-config';
for(const r of rows.filter(r=>r.container==='isobmff')){
  if(isoNativeChecks[r.field]){r.treatment='compare';r.check=isoNativeChecks[r.field];r.reason='Read the native declaration and corroborate the admitted representation; remaining opaque interpretation bytes compare exactly within ISO, and an unproved cross-container representation refuses.';r.code||='REMUX_NATIVE_'+r.field.replace(/[^a-z0-9]/gi,'_').toUpperCase();}
  if(['urn ','mehd','ssix','prft'].includes(r.field)){r.treatment='require-default';r.check='absent';r.reason='This independent external resource, duration, subsegment or wall-clock declaration has no verified carried target representation.';r.code='REMUX_NATIVE_'+r.field.trim().toUpperCase();}
}
for(const r of rows)if(r.container==='mpegts'&&r.treatment==='covered')r.witness='transport:'+r.field;
for(const r of rows)if(r.treatment==='covered'&&r.container==='isobmff'&&['stts','ctts','stsz','stz2','stsc','stco','co64','stss','mdat'].includes(r.field))r.witness='packet:'+r.id;
for(const r of rows)if(r.treatment==='covered'&&r.container==='isobmff'&&['trex','tfhd','tfdt','trun'].includes(r.field))r.witness='fragment:'+r.id;
for(const r of rows)if(r.treatment==='covered'&&r.container==='matroska'&&['Timestamp','SimpleBlock','Block','BlockDuration','ReferenceBlock','DiscardPadding'].includes(r.field))r.witness='packet:'+r.id;
const packetWitnessChecks={stts:'REMUX_PACKET_TIMING',ctts:'REMUX_PACKET_REORDER',stsz:'REMUX_EVIDENCE_DECODE',stz2:'REMUX_EVIDENCE_DECODE',stsc:'REMUX_EVIDENCE_DECODE',stco:'REMUX_CODEC_PARAMETERS',co64:'REMUX_CODEC_PARAMETERS',stss:'REMUX_EVIDENCE_DECODE',mdat:'REMUX_PACKET_PAYLOAD',Timestamp:'REMUX_NATIVE_CUETIME',SimpleBlock:'REMUX_PACKET_PAYLOAD',Block:'REMUX_PACKET_PAYLOAD',BlockDuration:'REMUX_PACKET_TIMING'};
for(const r of rows)if(r.witness==='packet:'+r.id)r.check='Complete packet timing/order/payload and coded-header inspection: '+packetWitnessChecks[r.field];
for(const r of rows)if(r.treatment==='covered'&&!r.witness&&(r.container==='isobmff'&&isoMasters.has(r.field)||r.container==='matroska'&&r.type==='master')){
  r.witness='structure:'+r.id;r.check='native classified child walk';r.reason='The master has no scalar playback value. Its complete child list is walked, including streaming Cluster masters; every known child has its own enforced row and unlisted children refuse.';
}
// Native checks and source refusals use compare/require-default treatments.
// The observer deliberately skips covered scalar values: annotations cannot
// turn such a row into a native check. Only its executable witness earns it.
const isoSeekFields=new Set('stss stco co64 stsc stsz stz2 stts ctts trex tfhd tfdt trun'.split(' '));
const mkvSeekFields=new Set('SeekHead Seek SeekID SeekPosition Position PrevSize Cues CuePoint CueTime CueTrackPositions CueTrack CueClusterPosition CueRelativePosition CueDuration CueBlockNumber'.split(' '));
for(const r of rows){
  if(r.container==='isobmff'&&isoSeekFields.has(r.field)||r.container==='matroska'&&mkvSeekFields.has(r.field)){
    r.treatment='compare';r.check=r.container==='isobmff'?'iso-seek':'mkv-seek';r.code='REMUX_NATIVE_'+r.field.toUpperCase();delete r.witness;
    r.reason='Validate the native index against this file’s own packet extents, coded access points and clocks; rewritten offsets compare by mapped packet ordinal, never by byte equality.';
  }
  if(r.container==='matroska'&&r.field==='CueCodecState'){r.treatment='require-default';r.check='mkv-default';r.nativeDefault=0;r.code='REMUX_NATIVE_CUECODECSTATE';delete r.witness;}
  if(r.container==='matroska'&&['CueReference','CueRefTime','CueRefCluster','CueRefNumber','CueRefCodecState'].includes(r.field)){
    r.treatment='require-default';r.check='absent';r.code='REMUX_NATIVE_CUEREFERENCE';delete r.witness;r.reason='The enclosing dependent CueReference graph has no proved rewritten target mapping; it must be absent.';
  }
  if(r.container==='isobmff'&&r.field==='stps'){r.treatment='require-default';r.check='absent';r.reason='Partial-sync recovery has no proved native packet/index mapping for this route.';}
  if(r.container==='isobmff'&&r.field==='mfra'){r.treatment='compare';r.check='iso-index';r.code='REMUX_NATIVE_MFRA';delete r.witness;r.reason='Native footer and per-track index cardinality are verified; tfra entries resolve to independently coded own packets.';}
  if(r.container==='isobmff'&&['sv3d','proj'].includes(r.field)){r.check='projection-structure';r.reason='Validate native child cardinality; each projection subfield is independently compared by its own native child row. Unproved cross-container projection refuses.';}
  if(r.container==='isobmff'&&r.field==='vmhd.opcolor'){r.treatment='descriptive';r.check='ignored-copy-operands';r.code=null;r.reason='All six operand bytes are ignored by the admitted copy/dither-copy graphics modes; modes that use them are refused by the separate graphics-mode guard.';}
  if(r.container==='isobmff'&&r.field==='ilst.numeric-key-item')r.code='REMUX_NATIVE_META_INDEX';
  if(r.container==='isobmff'&&['sgpd','sbgp'].includes(r.field)){r.treatment='require-default';r.reason='Require the complete own-sample AAC roll-minus-one mapping; other recovery/group selection semantics refuse before Ready.';}
  if(r.container==='mpegts'&&['PCR','PTS_DTS','PAT','PMT'].includes(r.field)){r.treatment='compare';r.check='transport-native';r.code={PCR:'REMUX_TS_PCR_BACKWARDS',PTS_DTS:'REMUX_TS_DTS_BACKWARDS',PAT:'REMUX_TS_PROGRAM_CHANGED',PMT:'REMUX_TS_PROGRAM_CHANGED'}[r.field];}
}
for(const [field,code,reason]of [['random_access_indicator','REMUX_TS_RANDOM_ACCESS','Each asserted native access point is bound to a complete bounded PES beginning with an AVC IDR or aligned AAC frame.'],['PES_optional_seek_controls','REMUX_TS_PES_OPTIONAL','ESCR/rate/copy/CRC/extensions are refused rather than silently skipped.'],['PES_trick_mode','REMUX_TS_PES_TRICK_MODE','Trick-mode selection must be absent.'],['PES_scrambling','REMUX_TS_PES_ENCRYPTED','PES scrambling must be absent.']])rows.push({id:'mpegts:'+field,container:'mpegts',field,treatment:field==='random_access_indicator'?'compare':'require-default',check:'transport-native',code,enforcement:'transport-integrity',witness:'transport:'+field,reason});
const controlCodes={
  'mvhd.rate':['REMUX_SOURCE_PLAYBACK_UNSUPPORTED','REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
  'mvhd.volume':['REMUX_SOURCE_PLAYBACK_UNSUPPORTED','REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
  'mvhd.matrix':['REMUX_SOURCE_PLAYBACK_UNSUPPORTED','REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
  'mvhd.timescale':['REMUX_SOURCE_EDIT_UNSUPPORTED','REMUX_EDIT_LIST_UNEXPECTED'],
  'mvhd.duration':['REMUX_SOURCE_DURATION_UNVERIFIED','REMUX_MOVIE_DURATION_UNEXPECTED'],
  'tkhd.flags':['REMUX_SOURCE_PLAYBACK_UNSUPPORTED','REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
  'tkhd.layer':['REMUX_SOURCE_CONTROL_UNREPRESENTABLE','REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
  'tkhd.volume':['REMUX_SOURCE_PLAYBACK_UNSUPPORTED','REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
  'tkhd.matrix':['REMUX_SOURCE_PLAYBACK_UNSUPPORTED','REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
  'tkhd.width':['REMUX_TRACK_GEOMETRY_UNSUPPORTED'], 'tkhd.height':['REMUX_TRACK_GEOMETRY_UNSUPPORTED'],
  'tkhd.duration':['REMUX_SOURCE_DURATION_UNVERIFIED','REMUX_TRACK_DURATION_UNEXPECTED'],
  edts:['REMUX_SOURCE_EDIT_UNSUPPORTED','REMUX_EDIT_RATE_UNSUPPORTED'],elst:['REMUX_SOURCE_EDIT_UNSUPPORTED','REMUX_EDIT_RATE_UNSUPPORTED'],
  'mdhd.timescale':['REMUX_PACKET_TIMING'], 'mdhd.duration':['REMUX_SOURCE_PLAYBACK_UNVERIFIED','REMUX_MEDIA_DURATION_UNEXPECTED'],
  'smhd.balance':['REMUX_SOUND_BALANCE_UNSUPPORTED'],tapt:['REMUX_TRACK_APERTURE_UNSUPPORTED'],clef:['REMUX_TRACK_APERTURE_UNSUPPORTED'],prof:['REMUX_TRACK_APERTURE_UNSUPPORTED'],enof:['REMUX_TRACK_APERTURE_UNSUPPORTED'],colr:['REMUX_NATIVE_COLR_PROFILE']
};
for(const [field,code,reason]of [['M2TS_arrival_control','REMUX_TS_M2TS_ARRIVAL_CONTROL','The192-byte wrapper carries copy/arrival timestamp controls; no native target mapping is proved, so the source refuses.'],['RS204_parity','REMUX_TS_RS204_PARITY','The204-byte outer error-correction code can affect packet interpretation; parity must not be silently discarded without native proof.']])rows.push({id:'mpegts:'+field,container:'mpegts',field,treatment:'require-default',check:'transport-wrapper',code,witness:'transport:'+field,reason});
for(const [field,element]of [['SimpleBlock.flags','0xa3'],['Block.flags','0xa1']])row('matroska',field,'compare','Native block framing, coded key/reference status and unsupported lacing/invisible/reserved flags are checked independently of compressed payload identity.','mkv-seek',{element,type:'binary',code:'REMUX_NATIVE_BLOCK_FLAGS'});
for(const r of rows)if(r.container==='matroska'&&['SimpleBlock','Block'].includes(r.field))r.reason='The coded payload has a complete packet-identity witness. Header flags have a separate native row; native track/time/index checks independently bind the block header.';
for(const r of rows.filter(r=>r.witness)){
  let codes=r.container==='isobmff'?controlCodes[r.field]:null;
  if(r.witness.startsWith('structure:'))codes=['REMUX_NATIVE_UNCLASSIFIED'];
  if(r.check.startsWith('parent-presence:'))codes=[rows.find(p=>p.id===r.check.slice(16)).code];
  if(r.container==='isobmff'&&r.field.startsWith('tref.'))codes=['REMUX_NATIVE_TREF'];
  if(r.witness.startsWith('packet:'))codes=[packetWitnessChecks[r.field]];
  if(r.witness.startsWith('transport:'))codes=[r.code||({ADTS:'REMUX_TS_ADTS_CONFIG',AVC:'REMUX_TS_PARAMETER_CHANGE'}[r.field])];
  if(codes)r.witnessCodes=Object.freeze({source:codes[0],output:codes[1]||codes[0]});
}
function assertCoveredInventory(inventory=rows){for(const r of inventory)if(r.treatment==='covered'&&(typeof r.witness!=='string'||!r.witness.trim()||!r.witnessCodes?.source||!r.witnessCodes?.output))
  throw Error('Unproved covered native inventory row: '+r.id);return true;}
function assertInventory(inventory=rows,known){const seen=new Set();for(const r of inventory){if(seen.has(r.id)||!['compare','require-default','covered','descriptive'].includes(r.treatment)||!r.reason||!r.check)throw Error('Incomplete/duplicate native inventory row: '+r.id);seen.add(r.id);}
  if(known)for(const [key,selector]of [['boxes','atom'],['elements','element'],['descriptors','tag']])for(const item of known[key])if(!inventory.some(r=>r[selector]===item))throw Error('Unlisted native inventory item: '+key+':'+item);
  return true;}
assertInventory();
const INVENTORY=Object.freeze(rows.map(Object.freeze));
function table(){return '| Field | Container | Treatment | Reason / check | Code | Enforcement / witness |\n|---|---|---|---|---|---|\n'+INVENTORY.map(r=>`| ${r.field.replace(/\|/g,'/')} | ${r.container} | ${r.treatment} | ${r.reason} ${r.check} | ${r.code||'—'} | ${r.witness||r.nativeCheck||r.refusal||r.enforcement||(r.treatment==='covered'?'UNPROVED':'native / descriptive')} |`).join('\n')+'\n';}
module.exports={MATROSKA_SCHEMA,INVENTORY,SOURCES,assertInventory,assertCoveredInventory,table};
