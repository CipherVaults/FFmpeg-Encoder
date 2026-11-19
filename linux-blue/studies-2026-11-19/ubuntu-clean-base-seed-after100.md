# One clean Ubuntu 24.04 amd64 seed, then an isolated solver

Read-only proposal, 19 November 2026. No downloads, APT, installation, container, executable invocation, or canonical changes. Checkpoint100 publication remains primary. Based on closure-after099/PLAN.md and the existing085 manufacture recipe/lock template.

## Recommended concrete seed
Choose one versioned official Ubuntu Base amd64 archive, not the hosted runner's 1,212-package inventory. The official release listing currently offers `ubuntu-base-24.04.5-base-amd64.tar.gz` (approximately 29 MB) alongside SHA256SUMS and SHA256SUMS.gpg. Before any acquisition, freeze the exact filename, expected size/digest and independently trusted signing-key fingerprint; verify signature and archive digest after a separately authorized download. Listing availability is not signature verification or a current immutable pin. Do not select a moving `latest` tag.

Official source: https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/

This is a small, concrete complete-base candidate. Future safe inspection should obtain its actual dpkg status, Essential/required packages, shell, libc loader and interpreter inventory; do not assume exact contents from the name. Keep base packages explicit roots, even if APT would omit them from an install transaction. Ordinary rootfs symlinks are expected: the085 source-tar policy that rejects all links cannot simply extract this image. A separately reviewed rootfs reader/extractor must inspect metadata without following escaping links, reject devices/path escapes and preserve needed in-root symlinks. No extraction or execution is authorized now.

## Solver is complementary, not an alternative runnable base
Use that verified base inventory as owned `Dir::State::status`, with owned lists/cache/config, explicit amd64, official noble/noble-updates/noble-security sources and no recommends. Ubuntu's apt.conf documents state/status redirection and RootDir applying even to absolute paths. This is path configuration, NOT a security sandbox. Clear inherited APT configuration/hooks and pin the solver/tool identities; review all effective paths before a bounded metadata-only simulation. No dpkg execution, maintainer scripts, host status or third-party repositories.

Official reference: https://manpages.ubuntu.com/manpages/noble/man5/apt.conf.5.html

Resolve the existing23 recipe ROOTS plus explicit base/Essential/interpreter roots. Keep selected alternatives/providers and version/architecture edges, including already-present reachable nodes. Join every selected tuple to verified signed Packages bytes, not apt-cache origin text. A zero-exit simulation and seven Inst lines do not constitute the complete dependency lock. Refuse missing/conflicting tuples and retain a bounded unresolved result; do not enumerate or repair the full hosted inventory.

Alternative bootstrap path: Ubuntu documents minbase-style provisioning through its mmdebstrap plugin. This avoids pinning a prebuilt image but adds a bootstrap implementation/version/seed and maintainer-script execution contract; it is not the smaller immediate step here. https://ubuntu.com/docs/imagecraft/1/reference/plugins/mmdebstrap_plugin/

## Small next deliverable and remaining gates
Prepare a finite seed-acquisition/metadata-inspection specification, then one isolated solver specification. No execution yet. Freeze index-byte, graph-node/edge, subprocess, time and output caps before authorization. Later authenticate exact .deb Size/SHA and actual compiler/interpreter/helper payload bytes, including tools already in the base. Retain signed metadata for replay under separately approved artifact scope. A signed image digest does not alone map each tool to signed package stanzas.

085 manufacture remains unchanged: four jobs, isolated owned prefix, restricted tool/search paths, static x264/x265/dav1d/SVT-AV1 intent, and a verified network-disabled build boundary. Rootfs provisioning and build execution require separate review/release. Final ELF/dlopen/runtime closure and Electron desktop dependencies remain separate acceptance gates. No AV1 removal, host upgrades, portable-release claim, or new lock registry is proposed.
