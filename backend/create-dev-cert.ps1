param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$directory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $directory -Force | Out-Null

$certificate = New-SelfSignedCertificate `
  -DnsName 'localhost' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears(2)

$randomBytes = New-Object byte[] 32
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$random.GetBytes($randomBytes)
$passwordText = [System.BitConverter]::ToString($randomBytes).Replace('-', '')
$random.Dispose()

$password = ConvertTo-SecureString -String $passwordText -AsPlainText -Force
Export-PfxCertificate -Cert $certificate -FilePath $OutputPath -Password $password -Force | Out-Null
[System.IO.File]::WriteAllText("$OutputPath.pass", $passwordText)
Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($certificate.Thumbprint)"
