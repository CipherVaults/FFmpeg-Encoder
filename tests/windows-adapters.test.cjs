'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { parseAdapterInventory, queryWindowsAdapters } = require('../src/windows-adapters.cjs');
const adapter = (overrides = {}) => ({ adapterIndex: 0, description: 'Test GPU', luid: '00000000:00000001', umdVersion: '32.0.1.2',
  vendorId: 0x1002, deviceId: 1, subsystemId: 2, revision: 1, flags: 0, dedicatedVideoBytes: 8 * 1024 ** 3, driverQueryHresult: 0, ...overrides });
const parse = (adapters, status = 'complete') => parseAdapterInventory(JSON.stringify({ status, adapters }));

test('DXGI ordinal and UMD identity remain observations, not encoded-media support', () => {
  const result = parse([adapter(), adapter({ adapterIndex: 1, luid: '00000000:00000002', vendorId: 0x8086 })]);
  assert.deepEqual(result.adapters.map(row => [row.adapterIndex, row.backendCandidate]), [[0, 'amf'], [1, 'qsv']]);
  assert.equal(result.adapters[0].available, undefined);
  assert.match(result.driverVersionScope, /vendor-runtime qualification remains separate/);
});
test('software adapters and unrelated vendors cannot become AMD or Intel candidates', () => {
  assert.equal(parse([adapter({ flags: 2 })]).adapters[0].backendCandidate, null);
  assert.equal(parse([adapter({ vendorId: 0x10de })]).adapters[0].backendCandidate, null);
});
test('partial discovery and failed driver query remain explicit', () => {
  const result = parse([adapter({ driverQueryHresult: -2147467259, umdVersion: null })], 'partial');
  assert.equal(result.status, 'partial'); assert.equal(result.adapters[0].umdVersion, null);
  assert.equal(parse([], 'complete').adapters.length, 0);
});
test('malformed, excessive, duplicate or unordered identities are rejected', () => {
  for (const rows of [[adapter({ adapterIndex: 1 })], [adapter(), adapter({ adapterIndex: 1 })],
    [adapter({ description: 'bad\0name' })], [adapter({ driverQueryHresult: -1 })], [adapter({ umdVersion: null })],
    [adapter({ vendorId: -1 })], [adapter({ dedicatedVideoBytes: Number.MAX_SAFE_INTEGER + 1 })],
    [adapter({ arbitraryPath: 'C:\\anything' })], Array.from({ length: 33 }, (_, i) => adapter({ adapterIndex: i }))]) {
    assert.throws(() => parse(rows), { code: 'ADAPTER_DISCOVERY_INVALID' });
  }
  for (const text of ['not JSON', ' '.repeat(65537), JSON.stringify({ status: 'complete', adapters: [], extra: true })]) {
    assert.throws(() => parseAdapterInventory(text), { code: 'ADAPTER_DISCOVERY_INVALID' });
  }
});
test('unsupported platforms, invalid roots and cancellation do not launch a helper', async () => {
  let invoked = false; const run = async () => { invoked = true; throw new Error('unexpected'); };
  assert.equal((await queryWindowsAdapters({ platform: 'linux', run })).status, 'unavailable');
  assert.equal((await queryWindowsAdapters({ platform: 'win32', systemRoot: 'C:\\Windows\\..\\owned', run })).status, 'unavailable');
  await assert.rejects(queryWindowsAdapters({ run, signal: AbortSignal.abort() }), { code: 'CANCELLED' });
  assert.equal(invoked, false);
});

// These tests inspect the exact owned-child request but never execute its
// PowerShell payload. Native DXGI/.NET behavior remains a separate parent check.
test('Windows helper uses one fixed in-memory payload with no compiler, disk assembly or process launch', { skip: process.platform !== 'win32' }, async () => {
  const calls = [], controller = new AbortController();
  const run = async (executable, argv, options) => { calls.push({ executable, argv, options }); return { stdout: JSON.stringify({ status: 'complete', adapters: [adapter()] }), stderr: '' }; };
  const inventory = await queryWindowsAdapters({ run, signal: controller.signal });
  assert.equal(inventory.status, 'complete'); assert.equal(calls.length, 1);
  const { executable, argv, options } = calls[0];
  assert.match(executable, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.deepEqual(argv.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']); assert.equal(argv.length, 5);
  assert.equal(options.signal, controller.signal); assert.equal(options.timeoutMs, 20000); assert.equal(options.stdoutLimit, 65536); assert.equal(options.stderrLimit, 8192);
  const code = argv[4]; assert.equal(createHash('sha256').update(code).digest('hex').length, 64);
  for (const forbidden of [/\bAdd-Type\b/i, /\b(?:csc|vbc|cmd|msbuild)\.exe\b/i, /\b(?:Start-Process|Start-Job|Invoke-Expression|Set-ExecutionPolicy)\b/i,
    /\bProcess\]::Start\b/, /AssemblyBuilderAccess\]::(?:Save|RunAndSave)/, /\.Save\(/, /\$env:/i, /\$args\b/, /\$input\b/]) assert.doesNotMatch(code, forbidden);
  assert.match(code, /DefineDynamicAssembly\(\$assemblyName, \[System\.Reflection\.Emit\.AssemblyBuilderAccess\]::Run\)/);
  assert.match(code, /DefinePInvokeMethod\('CreateDXGIFactory1', 'dxgi\.dll', 'CreateDXGIFactory1'/);
  assert.match(code, /DefaultDllImportSearchPathsAttribute/); assert.match(code, /DllImportSearchPath\]::System32/); assert.match(code, /PreserveSig/);
  assert.match(code, /UnmanagedFunctionPointerAttribute/); assert.match(code, /CallingConvention\]::StdCall/);
  await queryWindowsAdapters({ run }); assert.deepEqual(calls[1].argv, argv, 'No per-request input can interpolate into the fixed native query');
});

test('fixed query records exact x64 DESC1 offsets, bounded enumeration and releases every owned interface/buffer', { skip: process.platform !== 'win32' }, async () => {
  let script;
  await queryWindowsAdapters({ run: async (_exe, argv) => { script = argv[4]; return { stdout: JSON.stringify({ status: 'complete', adapters: [] }), stderr: '' }; } });
  assert.equal(typeof script, 'string'); assert.match(script, /\[IntPtr\]::Size -ne 8/); assert.match(script, /AllocHGlobal\(312\)/);
  assert.match(script, /Unicode\.GetString\(\$raw, 0, 256\)/);
  for (const [field, offset] of [['vendorId', 256], ['deviceId', 260], ['subsystemId', 264], ['revision', 268], ['flags', 304]]) {
    assert.match(script, new RegExp(`${field} = \\[BitConverter\\]::ToUInt32\\(\\$raw, ${offset}\\)`));
  }
  assert.match(script, /dedicatedVideoBytes = \[BitConverter\]::ToUInt64\(\$raw, 272\)/);
  assert.match(script, /ToUInt32\(\$raw, 300\).*ToUInt32\(\$raw, 296\)/);
  assert.match(script, /Get-DxgiMethod \$factory 12/); assert.match(script, /Get-DxgiMethod \$adapter 10/); assert.match(script, /Get-DxgiMethod \$adapter 9/);
  assert.match(script, /\$index -le 32/); assert.match(script, /\$hr -eq -2005270526/); assert.match(script, /\$index -eq 32/);
  assert.match(script, /finally \{ if \(\$adapter -ne.*Marshal\]::Release\(\$adapter\)/);
  assert.match(script, /Marshal\]::Release\(\$factory\)/); assert.match(script, /foreach \(\$buffer in \$buffers\).*FreeHGlobal\(\$buffer\)/);
});

test('helper cancellation, timeout, native errors and contaminated output cannot become capability success', { skip: process.platform !== 'win32' }, async () => {
  await assert.rejects(queryWindowsAdapters({ run: async () => { throw Object.assign(new Error('Owned child cancelled and drained'), { code: 'CANCELLED' }); } }), { code: 'CANCELLED' });
  for (const response of [async () => { throw Object.assign(new Error('Owned child timed out and drained'), { code: 'TIMEOUT' }); },
    async () => ({ stdout: JSON.stringify({ status: 'complete', adapters: [adapter()] }), stderr: 'native failure' }),
    async () => ({ stdout: 'extra reflection object\n{"status":"complete","adapters":[]}', stderr: '' })]) {
    const inventory = await queryWindowsAdapters({ run: response }); assert.equal(inventory.status, 'unavailable'); assert.deepEqual(inventory.adapters, []);
  }
});
