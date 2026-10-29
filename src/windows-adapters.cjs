'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { runTool, ToolError } = require('./process-runner.cjs');

// Fixed read-only DXGI query. WMI list order is not the adapter ordinal used by
// FFmpeg's D3D11 device selector. EnumAdapters1 and GetDesc1 establish that order
// and LUID on this boot. Neither an adapter nor a wrapper proves encode support.
// References: Microsoft IDXGIFactory1::EnumAdapters1, IDXGIAdapter1::GetDesc1,
// IDXGIAdapter::CheckInterfaceSupport. UMD version is the queried interface's
// driver identity, not an invented marketing/package or vendor-runtime version.
const DXGI_QUERY = String.raw`
$ErrorActionPreference = 'Stop'
# Emit fixed signatures in memory. PowerShell 5 source compilation would create
# an unowned compiler child; Run-only Reflection.Emit needs no external tool,
# temporary assembly, install, profile or execution-policy change.
if ([IntPtr]::Size -ne 8) { throw 'DXGI discovery requires the qualified x64 layout.' }
$assemblyName = [System.Reflection.AssemblyName]::new('FFEncoderDxgiMemory')
$assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly($assemblyName, [System.Reflection.Emit.AssemblyBuilderAccess]::Run)
$module = $assembly.DefineDynamicModule('FFEncoderDxgiMemory')
$native = $module.DefineType('FFEncoderDxgiNative', [System.Reflection.TypeAttributes]'Public, Sealed, Abstract')
$factoryMethod = $native.DefinePInvokeMethod('CreateDXGIFactory1', 'dxgi.dll', 'CreateDXGIFactory1',
  [System.Reflection.MethodAttributes]'Public, Static, PinvokeImpl', [System.Reflection.CallingConventions]::Standard,
  [int], [Type[]]@([IntPtr], [IntPtr]), [System.Runtime.InteropServices.CallingConvention]::StdCall, [System.Runtime.InteropServices.CharSet]::Unicode)
$factoryMethod.SetImplementationFlags($factoryMethod.GetMethodImplementationFlags() -bor [System.Reflection.MethodImplAttributes]::PreserveSig)
$searchCtor = [System.Runtime.InteropServices.DefaultDllImportSearchPathsAttribute].GetConstructor([Type[]]@([System.Runtime.InteropServices.DllImportSearchPath]))
$searchAttribute = [System.Reflection.Emit.CustomAttributeBuilder]::new($searchCtor, [object[]]@([System.Runtime.InteropServices.DllImportSearchPath]::System32))
$factoryMethod.SetCustomAttribute($searchAttribute)
$nativeType = $native.CreateType()

function New-DxgiDelegateType([string]$name, [Type[]]$parameters) {
  $type = $module.DefineType($name, [System.Reflection.TypeAttributes]'Public, Sealed, Class', [MulticastDelegate])
  $constructor = $type.DefineConstructor([System.Reflection.MethodAttributes]'Public, HideBySig, SpecialName, RTSpecialName',
    [System.Reflection.CallingConventions]::Standard, [Type[]]@([object], [IntPtr]))
  $constructor.SetImplementationFlags([System.Reflection.MethodImplAttributes]'Runtime, Managed')
  $invoke = $type.DefineMethod('Invoke', [System.Reflection.MethodAttributes]'Public, HideBySig, NewSlot, Virtual', [int], $parameters)
  $invoke.SetImplementationFlags([System.Reflection.MethodImplAttributes]'Runtime, Managed')
  $callCtor = [System.Runtime.InteropServices.UnmanagedFunctionPointerAttribute].GetConstructor([Type[]]@([System.Runtime.InteropServices.CallingConvention]))
  $callAttribute = [System.Reflection.Emit.CustomAttributeBuilder]::new($callCtor, [object[]]@([System.Runtime.InteropServices.CallingConvention]::StdCall))
  $type.SetCustomAttribute($callAttribute)
  return $type.CreateType()
}
function Get-DxgiMethod([IntPtr]$item, [int]$slot, [Type]$delegateType) {
  if ($item -eq [IntPtr]::Zero) { throw 'A DXGI interface pointer was unavailable.' }
  $vtable = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($item)
  $method = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($vtable, $slot * [IntPtr]::Size)
  if ($method -eq [IntPtr]::Zero) { throw 'A DXGI interface method was unavailable.' }
  return [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($method, $delegateType)
}
$enumerateType = New-DxgiDelegateType 'FFEncoderDxgiEnumerate' ([Type[]]@([IntPtr], [uint32], [IntPtr]))
$descriptionType = New-DxgiDelegateType 'FFEncoderDxgiDescription' ([Type[]]@([IntPtr], [IntPtr]))
$driverType = New-DxgiDelegateType 'FFEncoderDxgiDriver' ([Type[]]@([IntPtr], [IntPtr], [IntPtr]))
$factory = [IntPtr]::Zero
$buffers = New-Object 'System.Collections.Generic.List[System.IntPtr]'
try {
  # x64 DXGI_ADAPTER_DESC1 is 312 bytes: UTF16[128], 4 uint32s,
  # 3 SIZE_Ts, LUID (low/high), flags, then trailing alignment padding.
  $factoryIid = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(16); $buffers.Add($factoryIid)
  $deviceIid = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(16); $buffers.Add($deviceIid)
  $factoryOut = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(8); $buffers.Add($factoryOut)
  $adapterOut = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(8); $buffers.Add($adapterOut)
  $desc = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(312); $buffers.Add($desc)
  $driverVersion = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(8); $buffers.Add($driverVersion)
  [System.Runtime.InteropServices.Marshal]::Copy(([Guid]'770aae78-f26f-4dba-a829-253c83d1b387').ToByteArray(), 0, $factoryIid, 16)
  [System.Runtime.InteropServices.Marshal]::Copy(([Guid]'54ec77fa-1377-44e6-8c32-88fd5f44c84c').ToByteArray(), 0, $deviceIid, 16)
  [System.Runtime.InteropServices.Marshal]::WriteIntPtr($factoryOut, [IntPtr]::Zero)
  $hr = [int]$nativeType.GetMethod('CreateDXGIFactory1').Invoke($null, [object[]]@($factoryIid, $factoryOut))
  $factory = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($factoryOut)
  [System.Runtime.InteropServices.Marshal]::ThrowExceptionForHR($hr)
  $enumerate = Get-DxgiMethod $factory 12 $enumerateType
  $items = New-Object 'System.Collections.Generic.List[object]'
  $complete = $false
  for ([uint32]$index = 0; $index -le 32; $index++) {
    [System.Runtime.InteropServices.Marshal]::WriteIntPtr($adapterOut, [IntPtr]::Zero)
    $hr = [int]$enumerate.DynamicInvoke([object[]]@($factory, $index, $adapterOut))
    $adapter = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($adapterOut)
    try {
      if ($hr -eq -2005270526) { $complete = $true; break } # DXGI_ERROR_NOT_FOUND 0x887a0002
      [System.Runtime.InteropServices.Marshal]::ThrowExceptionForHR($hr)
      if ($index -eq 32) { break }
      $description = Get-DxgiMethod $adapter 10 $descriptionType
      $raw = New-Object byte[] 312
      [System.Runtime.InteropServices.Marshal]::Copy($raw, 0, $desc, 312)
      [System.Runtime.InteropServices.Marshal]::ThrowExceptionForHR([int]$description.DynamicInvoke([object[]]@($adapter, $desc)))
      [System.Runtime.InteropServices.Marshal]::Copy($desc, $raw, 0, 312)
      $driver = Get-DxgiMethod $adapter 9 $driverType
      [System.Runtime.InteropServices.Marshal]::WriteInt64($driverVersion, 0)
      $driverHr = [int]$driver.DynamicInvoke([object[]]@($adapter, $deviceIid, $driverVersion))
      $umdVersion = $null
      if ($driverHr -ge 0) {
        $versionBytes = New-Object byte[] 8
        [System.Runtime.InteropServices.Marshal]::Copy($driverVersion, $versionBytes, 0, 8)
        $umdVersion = '{0}.{1}.{2}.{3}' -f [BitConverter]::ToUInt16($versionBytes, 6), [BitConverter]::ToUInt16($versionBytes, 4), [BitConverter]::ToUInt16($versionBytes, 2), [BitConverter]::ToUInt16($versionBytes, 0)
      }
      $name = [Text.Encoding]::Unicode.GetString($raw, 0, 256)
      $nullAt = $name.IndexOf([char]0); if ($nullAt -ge 0) { $name = $name.Substring(0, $nullAt) }
      $items.Add([pscustomobject]@{ adapterIndex = [int]$index; description = $name;
        vendorId = [BitConverter]::ToUInt32($raw, 256); deviceId = [BitConverter]::ToUInt32($raw, 260);
        subsystemId = [BitConverter]::ToUInt32($raw, 264); revision = [BitConverter]::ToUInt32($raw, 268);
        dedicatedVideoBytes = [BitConverter]::ToUInt64($raw, 272);
        luid = ('{0:x8}:{1:x8}' -f [BitConverter]::ToUInt32($raw, 300), [BitConverter]::ToUInt32($raw, 296));
        flags = [BitConverter]::ToUInt32($raw, 304); driverQueryHresult = $driverHr; umdVersion = $umdVersion })
    } finally { if ($adapter -ne [IntPtr]::Zero) { [void][System.Runtime.InteropServices.Marshal]::Release($adapter) } }
  }
  $status = if ($complete) { 'complete' } else { 'partial' }
  [pscustomobject]@{ status = $status; adapters = $items.ToArray() } | ConvertTo-Json -Depth 4 -Compress
} finally {
  if ($factory -ne [IntPtr]::Zero) { [void][System.Runtime.InteropServices.Marshal]::Release($factory) }
  foreach ($buffer in $buffers) { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
}
`;

function parseAdapterInventory(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw new ToolError('ADAPTER_DISCOVERY_INVALID', 'Adapter inventory exceeded its bound.');
  let value; try { value = JSON.parse(text); } catch { throw new ToolError('ADAPTER_DISCOVERY_INVALID', 'Adapter inventory was not JSON.'); }
  const exact = (item, fields) => item && typeof item === 'object' && !Array.isArray(item)
    && Object.keys(item).sort().join(',') === [...fields].sort().join(',');
  if (!exact(value, ['status', 'adapters']) || !['complete', 'partial'].includes(value.status)
    || !Array.isArray(value.adapters) || value.adapters.length > 32) throw new ToolError('ADAPTER_DISCOVERY_INVALID', 'Adapter inventory shape is invalid.');
  const luids = new Set();
  for (const [index, row] of value.adapters.entries()) {
    if (!exact(row, ['adapterIndex', 'description', 'luid', 'umdVersion', 'vendorId', 'deviceId', 'subsystemId', 'revision', 'flags', 'dedicatedVideoBytes', 'driverQueryHresult'])
      || row.adapterIndex !== index || !/^[0-9a-f]{8}:[0-9a-f]{8}$/.test(row.luid) || luids.has(row.luid)
      || typeof row.description !== 'string' || row.description.length > 128 || /[\x00-\x1f\x7f]/.test(row.description)
      || !['vendorId', 'deviceId', 'subsystemId', 'revision', 'flags'].every(field => Number.isInteger(row[field]) && row[field] >= 0 && row[field] <= 0xffffffff)
      || !Number.isSafeInteger(row.dedicatedVideoBytes) || row.dedicatedVideoBytes < 0
      || !Number.isInteger(row.driverQueryHresult) || row.driverQueryHresult < -2147483648 || row.driverQueryHresult > 2147483647
      || (row.driverQueryHresult < 0 ? row.umdVersion !== null : typeof row.umdVersion !== 'string' || !/^\d{1,5}(\.\d{1,5}){3}$/.test(row.umdVersion))) {
      throw new ToolError('ADAPTER_DISCOVERY_INVALID', 'Adapter identity, order or driver observation is invalid.');
    }
    luids.add(row.luid);
  }
  return { ...value, source: 'DXGI EnumAdapters1', driverVersionScope: 'IDXGIDevice UMD version; vendor-runtime qualification remains separate',
    adapters: value.adapters.map(row => ({ ...row, software: Boolean(row.flags & 2),
      backendCandidate: row.flags & 2 ? null : row.vendorId === 0x1002 ? 'amf' : row.vendorId === 0x8086 ? 'qsv' : null })) };
}

async function queryWindowsAdapters({ run = runTool, platform = process.platform, systemRoot = process.env.SystemRoot, signal } = {}) {
  if (signal?.aborted) throw new ToolError('CANCELLED', 'Device discovery cancelled.');
  if (platform !== 'win32') return { status: 'unavailable', adapters: [], reason: 'This backend requires Windows DXGI discovery.' };
  try {
    if (typeof systemRoot !== 'string' || !/^[a-z]:[\\/]/i.test(systemRoot) || /[\0\r\n]/.test(systemRoot)
      || /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(systemRoot)) throw new Error('Invalid Windows root');
    const expectedRoot = path.win32.normalize(systemRoot).replace(/\\+$/, '');
    const root = await fs.lstat(expectedRoot);
    if (!root.isDirectory() || root.isSymbolicLink() || (await fs.realpath(expectedRoot)).toLowerCase() !== expectedRoot.toLowerCase()) throw new Error('Redirected Windows root');
    const executable = path.win32.join(expectedRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const stat = await fs.lstat(executable);
    if (!stat.isFile() || stat.isSymbolicLink() || (await fs.realpath(executable)).toLowerCase() !== executable.toLowerCase()) throw new Error('Redirected Windows helper');
    const result = await run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', DXGI_QUERY],
      { signal, timeoutMs: 20000, stdoutLimit: 65536, stderrLimit: 8192 });
    if (result.stderr?.trim()) throw new Error('Device helper reported an error');
    return parseAdapterInventory(result.stdout);
  } catch (error) {
    if (signal?.aborted || error.code === 'CANCELLED') throw new ToolError('CANCELLED', 'Device discovery cancelled.');
    return { status: 'unavailable', adapters: [], reason: 'DXGI device discovery could not be verified.', diagnostic: String(error.message).slice(0, 2048) };
  }
}

module.exports = { queryWindowsAdapters, parseAdapterInventory, WINDOWS_ADAPTER_QUERY: DXGI_QUERY };
