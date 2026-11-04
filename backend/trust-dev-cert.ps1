param(
  [string]$PfxPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'data\localhost.pfx')
)

$ErrorActionPreference = 'Stop'
$PfxPath = [System.IO.Path]::GetFullPath($PfxPath)
$passphrasePath = "$PfxPath.pass"
if (-not (Test-Path -LiteralPath $PfxPath -PathType Leaf)) {
  throw "Certificate file not found: $PfxPath. Start MedAlert once to generate it."
}
if (-not (Test-Path -LiteralPath $passphrasePath -PathType Leaf)) {
  throw "Certificate passphrase file not found: $passphrasePath."
}

$passphrase = (Get-Content -LiteralPath $passphrasePath -Raw).TrimEnd()
$password = ConvertTo-SecureString -String $passphrase -AsPlainText -Force
$pfx = Get-PfxData -FilePath $PfxPath -Password $password
$certificates = @($pfx.EndEntityCertificates | Where-Object {
  $_.Subject -eq 'CN=localhost' -and
  $_.Issuer -eq 'CN=localhost' -and
  @($_.DnsNameList | ForEach-Object { $_.Unicode }) -contains 'localhost'
})
if ($certificates.Count -ne 1) {
  throw 'The PFX must contain exactly one self-signed certificate for localhost.'
}

$certificate = $certificates[0]
$temporaryCertificate = Join-Path ([System.IO.Path]::GetTempPath()) "medalert-localhost-$($certificate.Thumbprint).cer"
try {
  if (-not (Get-ChildItem Cert:\CurrentUser\Root | Where-Object Thumbprint -eq $certificate.Thumbprint)) {
    Export-Certificate -Cert $certificate -FilePath $temporaryCertificate -Force | Out-Null
    & certutil.exe -user -addstore -f Root $temporaryCertificate | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Windows could not trust the localhost certificate (certutil exit code $LASTEXITCODE)."
    }
  }
  if (-not (Get-ChildItem Cert:\CurrentUser\Root | Where-Object Thumbprint -eq $certificate.Thumbprint)) {
    throw 'Windows did not add the localhost certificate to the current user trust store.'
  }
  Write-Host "Trusted MedAlert localhost certificate for this Windows user ($($certificate.Thumbprint))."
} finally {
  Remove-Item -LiteralPath $temporaryCertificate -Force -ErrorAction SilentlyContinue
}
