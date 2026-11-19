# Remux080 inert recovery references

These three text files preserve the exact independently reviewed preparation scripts so a machine reset does not erase useful code. They are historical source references, not executable authority or product activation. Do not run them in place.

No BINDING.json, LEAD_RELEASE.json, raw logs, runtime binaries, private filesystem bindings or approval receipts are included. The code uses its own directory and reads external binding/gate data; those must be freshly reconstructed and reviewed against the preserved source, runtime, fixture and current host before a separately authorized attempt. The scope string current079-remux-lifecycle-acquisition080 is historical and must not be mistaken for a fresh080 source binding.

Independent final driver review SHA256:793ab5c43c5537d8f87c55135cb13dc76e6b47666326999c7c778c921ab69e94. Reviewed driver handoff SHA256:1fef2d55af29b3ee55ae8a90465e4abfa5cbb30a9f50563e0d53bfaed19dae1f.

Exact reference bytes:

- `runner.cjs.txt`: 8201 bytes; SHA256 `8af86059c7f8fd87bac129ffde27cce0edd1b94f30f71b57c9700b8fbd468ecc`.
- `supervise.py.txt`: 5764 bytes; SHA256 `0283899050c407dfeaaeef17d56e9017e0c84909eaff5a65ff8d00f165bf63af`.
- `driver.test.cjs.txt`: 2427 bytes; SHA256 `4d442f0447c2f2d18c65f7d43c8441df5df718d77f49faabe4206ef106d01fa4`.

Recovery sequence: restore the text copies to an isolated proposal with their original names; verify these hashes; recover the private acquisition recipe and source/fixture/runtime identities; create a new immutable binding to the actual frozen source; independently review the binding and resource/closure controls; wait for explicit lead release. Never reuse an old approval gate. The private acquisition cap is32 invocation attempts per instance, at most two instances; failure is not permission to enlarge it.

Privacy review read all three scripts and checked for embedded workspace/home paths, credentials and keys. None were found. General operating-system paths such as /proc and environment-variable names are code, not personal data. The scripts can produce private diagnostic data when executed; those future outputs are not authorized for publication by these references.

No runtime, cancellation, desktop reveal, shipped remux or release qualification is established by preserving these texts.
