# Regular Windows 9.1 rebuild and vendor command port

## Decision and source boundary

On November 21, 2026, Ahmed approved two sequential offline builds for the regular Windows candidate and fresh product qualification. The public CP148 snapshot is the integration base. The engine input and build records are held with the project’s private evidence. The published Beta and separate Windows Alpha retain their own source, engine, and acceptance records.

Both corrected guests received 10,240 MiB, ran on separate clean roots, and verified 21 pinned files before building. Nine source archives and ten tool archives had exact byte and SHA-256 pins. The remaining files were the FFmpeg signing key and detached signature. Each guest verified the signature without network access. The recipe added the pinned AMF headers and static oneVPL dispatcher. It applied the oneVPL compatibility define only to that dependency, froze the upstream source epoch, and requested zero PE linker timestamps. The upstream source files were never patched.

## Engine evidence

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| FFmpeg | 53,270,528 | `30c48cf14402bbd2aee20977d0b28263ea5c2758247f1e3d342594f9e44db798` |
| FFprobe | 53,071,360 | `1c934c5cd0d5cc4a60daafc1fc74e0056237d8db7f04a20944567b65d719ce86` |
| Private corresponding-source bundle | 44,906,646 | `7d267bcbdfad4f23e765bd005c7b25e783c54c9064e5764cf5288c5830e85e4d` |

The ordered pair identity is `faea502a4addd1dde4b74f1a63ae454d3615c7c04fac7d9b20b85a77c74b5590`. The two raw pairs match each other and differ from the retained Alpha pair. Each guest passed 18 fresh checks, including six CPU codec cases, exact registration, offline configuration, import checks and the missing-input refusals. Both Sandbox sessions closed. The original trial stopped at a oneVPL pkg-config field mismatch and produced zero FFmpeg executables. Its failure receipt is retained. The rebuilt source bundle passed a 75-member readback and contains the sealed layout and both MinGW runtime notices. Native GPU execution, ordinary service, and package acceptance have their own gates.

## Q vendor port on the 9.0.2 control baseline

The ordinary builder emits exact per-kind stream-copy arguments. The held vendor repair now binds a private receipt from that same inspected command before substituting the approved vendor profile and device arguments. Whole command, file identities, route checks, prepared-argument hashing and publication validation still apply. Current Linux source bytes and enclosing inert package entries were rebound mechanically. The historical Linux evidence and runtime authority stay with their original bytes.

The pre-port Windows suites reported 77 passes and 50 failures, including the command-shape refusal that this port addresses. The focused after-port Windows receipt `q-windows-vendor-per-stream-902` passed 172 of 172 controlled checks. The old optional-color fixture had a receipt from a different probe and now mints its receipt from the same probe used for argv. Exploratory Windows runs of the Linux-only suite stopped on Linux platform checks. Their failures are retained and fresh Linux execution remains pending. Independent source review found the ordinary and Linux evidence boundaries preserved. The local Windows shared-core source selection also passed all 524 tests and its syntax checks. It selected the Windows scope only.

## Continuation

Port the reviewed Remux corrections and reconcile the changed service test with CP146 readiness and cancellation. Switch the regular Windows runtime to the new pair with its own manifest and recipe provenance. Qualify each claimed route freshly. Verified TS seeking must match the first displayed frame and exact PTS from independent linear decoding at all six frozen targets. R and S remain open. This is development for the approved integration branch.

## Q Remux source corrections

The eight reviewed Windows WIP paths were transplanted from their verified snapshot. The service test change is limited to the storage case and preserves the later CP146 Ready, cancellation and target checks. Both verifier methods budget the complete native source walk. Omitted audio spends no PCM and may claim no video seek coverage. The new cue fixtures use owned temporary directories.

The receipt q2j-readmission-port-final-902 passed 182 of 182 Windows checks. Three additional static Linux-source and historical-pin checks passed on Windows. Current Linux source and inert inventory rows were rebound without changing historical receipts. The 1,340 old comparisons remain historical. The remaining 364 do not answer the current qualification question. Normal-service 9.1 media evidence remains pending.
