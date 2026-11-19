# One-image UNBOUND synthetic protocol proposal

This is deliberately NOT a live acquisition backend or release-ready runner. It has no socket, subprocess, GPG import, extraction or installation implementation. Its sole adapters are explicit synthetic interfaces. A synthetic successful protocol always records accepted:false, synthetic:true. No downloaded key/image or actual signer exists here.

Implemented: fixed four URLs, three serial command descriptions, five-minute checks including final acceptance,20s remaining socket request and30s remaining child budgets;64KiB/64KiB/256KiB metadata and64MiB image limits;128MiB tree and27GiB floor contracts; exclusive output and immutable input identity checks; bounded machine key/status/checksum parsing; rejected/multiple signatures, exact primary and inspected signer correlation, date/expiry/algorithm policy; immutable-input checks around every child and final archive acceptance; retained failure receipt independent of expired success. No exact unverified image size assumed. Changed digest does not update the pin.

The previous prospective size-pin prerequisite is superseded by UNBOUND_ACQUISITION_SPEC.md. PROSPECTIVE_PINS.json is retained exact as historical identification input, not authority to impose the stale exact-size requirement.

## Signature binding is not a label
Official GnuPG DETAILS documents VALIDSIG signer/primary fields. Parsing these correlates the cryptographic verifier's result; show-keys adjacency alone is NOT proof of a valid subkey binding. Official getkey.c merge_keys_and_selfsig path examines primary-issued binding signatures and invalidates subkeys lacking usable binding. Official sig-check.c checks key validity and signing back-signatures; missing cross-certification handling depends on require_cross_cert. gpgv documentation explicitly does not enforce expired/revoked keys and trusts supplied keyrings. Therefore the exact installed gpg/gpgv version and its binding/cross-certification behavior MUST be independently pinned and demonstrated with cryptographic negative fixtures before a live adapter can accept a subkey. No synthetic boolean or listing can discharge this obligation. The prototype's subkey positive test is only status correlation, not cryptographic acceptance.

Current parsers intentionally accept only an initial RSA>=2048 signing scope, SHA256/384/512, v4 binary-document signatures. Unknown statuses/structures fail closed. Actual signer not yet observed; incompatible real output requires review, not permissive fallback. Key data from a keyserver can omit revocations; authenticated freshness/completeness is not claimed.

Primary sources inspected on2026-11-19:
- https://www.gnupg.org/documentation/manuals/gnupg/gpgv.html
- https://raw.githubusercontent.com/gpg/gnupg/master/doc/DETAILS (VALIDSIG; colon records)
- https://raw.githubusercontent.com/gpg/gnupg/master/g10/getkey.c (merge_selfsigs_subkey)
- https://raw.githubusercontent.com/gpg/gnupg/master/g10/sig-check.c (check_signature_ext/back signatures)
These moving source references explain the design; they are NOT a pin to a locally executed binary. No external source file was installed or executed.

## Remaining concrete live binding work (not performed)
Reuse signed-index bounded HTTPS transport only after URL/redirect/proxy/absolute socket deadline adaptation is reviewed. Synthetic read timeout does not prove blocked socket/DNS preemption. Reuse reviewed current-UID canonical no-follow owned directory/file descriptor identity utilities, actual free/tree monitoring and an outer process supervisor. Pin gpg/gpgv plus dynamic loader/libraries, source/helper bytes and machine clock; inspect exact binary-version binding semantics. Bind fresh home with no config/trustdb/keyring inheritance and no network-capable child context. The explicit child environment shown is a plan, not an OS network sandbox. GPG explicit --output - --dearmor stdout is captured then exclusively written by owner, avoiding --output overwrites. Three command descriptions remain fixed; no extra child permission is implied.

Synthetic store.snapshot represents bytes AND ordinary-file identity in a future backend; the in-memory test store is not a no-follow filesystem test. Likewise synthetic child.closed is not actual process closure. Live implementation must supply those guarantees and independently review them before any acquisition. No image metadata reader is invoked by this protocol. Signed Packages dependency closure, tool archives, manufacture and Linux portability remain separate.

## Command-model correction
The original prototype omitted an explicit stdout destination. Corrected command uses `--output - --dearmor /OWNED/key.asc`, as documented at https://www.gnupg.org/documentation/manuals/gnupg/GPG-Input-and-Output.html . This selects stdout, not a writable output path. Exact argv and missing/default/file destination negative tests added. Original directory remains unchanged; no actual GPG was executed.
