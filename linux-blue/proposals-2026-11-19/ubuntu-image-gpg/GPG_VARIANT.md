# UNBOUND existing-gpg successor

Source-only successor of corrected synthetic adapter handoff 3d36c7d376875af5d1227df06eb9bfe2b2dcd248f2a622f14960d762cfd73683. Original directory and bytes untouched. This directory copies its historical REVIEW_BOUNDARY and pins unchanged; this addendum supersedes its gpgv command-model only. Three serial children remain descriptions, not executions. No live backend, key, image, binding or cryptographic result exists. Every protocol result remains accepted:false, synthetic:true.

All command descriptions now use gpg with explicit owned home, no options, no TTY/autostart/default keyring, an owned trustdb pathname, disabled automatic trustdb refresh/key import/key retrieval/dirmngr, and cleared key lookup mechanisms. Verification additionally names the exclusive owned dearmored keyring, requires cross-certification and uses --verify with both exact input files and a separate status descriptor. No trust-model-always or ignored expiration flags. The existing synthetic owner/store/process contracts remain unchanged; they are not actual filesystem/process/network guarantees. Fresh home must have no common.conf/keyboxd configuration in a future backend. No promise of zero writes: GPG may create bounded state in the owned home, never inherited user trust state.

The only added status is one exact TRUST_UNDEFINED 0 pgp record. It does not establish signer authority; exact VALIDSIG primary/signing fingerprint correlation, zero exit, primary/subkey listing lifetimes, signature time/date/algorithm checks and refusal of revoked/expired/error/unknown statuses remain mandatory. Other trust formats fail closed until reviewed. Absence of a published revocation in supplied key material is not an online freshness proof. Cross-certification is delegated to standard GPG, not inferred from listing adjacency or implemented here. Inert subkey cases test correlation only. No actual local binary option/version compatibility or official signer has been established.

Primary documentation read for this delta:
https://www.gnupg.org/documentation/manuals/gnupg/GPG-Configuration-Options.html
Sections --keyring/--no-default-keyring, --trustdb-name, --homedir, --no-auto-check-trustdb, --no-auto-key-import, --no-auto-key-retrieve, --auto-key-locate clear, --disable-dirmngr, --no-autostart and --require-cross-certification explain the fixed switches. These control configuration, retrieval and standard subkey checking; they are not an OS network sandbox.
https://www.gnupg.org/documentation/manuals/gnupg/GPG-Esoteric-Options.html
--status-fd defines the machine-status channel.
https://github.com/gpg/gnupg/blob/master/doc/DETAILS
Status syntax is correlated with the pinned primary, not human GOODSIG text alone.

Future separately reviewed actual controls must bind the existing executable and loader/dependencies, demonstrate supported flags and complete bounded status/closure, and supply real owned transport/filesystem/process implementations. No installation or live GPG was performed to create this proposal. Reader/solver/manufacturing authority remains separate. Source reviewed documentation is not a pin to the unexecuted local binary.
