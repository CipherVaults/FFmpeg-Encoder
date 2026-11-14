$ErrorActionPreference = 'Stop'

function Read-SvgXml([string] $source) {
    $settings = New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [System.Xml.XmlReader]::Create((New-Object System.IO.StringReader($source)), $settings)
    try {
        $document = New-Object System.Xml.XmlDocument
        $document.XmlResolver = $null
        $document.Load($reader)
        if ($document.DocumentElement.LocalName -ne 'svg' -or $document.DocumentElement.NamespaceURI -ne 'http://www.w3.org/2000/svg') {
            throw 'Expected SVG namespace and root'
        }
    } finally {
        $reader.Dispose()
    }
}

# Deliberately invalid, inert strings: ensure XML/DTD/root failures stop the check.
$negativeCases = @(
    '<svg xmlns="http://www.w3.org/2000/svg"><path></svg>',
    '<!DOCTYPE svg [<!ENTITY example "blocked">]><svg xmlns="http://www.w3.org/2000/svg"/>',
    '<html/>',
    '<svg/>'
)
foreach ($source in $negativeCases) {
    $refused = $false
    try { Read-SvgXml $source } catch { $refused = $true }
    if (-not $refused) { throw 'XML checker accepted a negative fixture' }
}

$files = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.svg' -File)
if ($files.Count -ne 60) { throw "Expected 60 SVGs, found $($files.Count)" }
foreach ($file in $files) { Read-SvgXml ([System.IO.File]::ReadAllText($file.FullName)) }
Write-Output "PASS: all $($files.Count) SVGs parse as XML; four malformed/DTD/root negative fixtures refused."
