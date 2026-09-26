# TradeFlow Standard v1 - signed request helper
# Compatible with Windows PowerShell 5.1+.
# Keep the API token and signing secret outside source control.

function ConvertTo-TradeFlowCanonicalJson {
    param([Parameter(Mandatory=$false)] $Value)

    if ($null -eq $Value) { return 'null' }

    if ($Value -is [System.Collections.IDictionary]) {
        $keys = @($Value.Keys | ForEach-Object { [string]$_ })
        [Array]::Sort($keys, [System.StringComparer]::Ordinal)
        $parts = foreach ($key in $keys) {
            $keyJson = ConvertTo-Json -InputObject ([string]$key) -Compress
            $valueJson = ConvertTo-TradeFlowCanonicalJson $Value[$key]
            $keyJson + ':' + $valueJson
        }
        return '{' + ($parts -join ',') + '}'
    }

    if ($Value -is [pscustomobject]) {
        $dict = @{}
        foreach ($property in $Value.PSObject.Properties) {
            $dict[$property.Name] = $property.Value
        }
        return ConvertTo-TradeFlowCanonicalJson $dict
    }

    if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
        $parts = foreach ($item in $Value) {
            ConvertTo-TradeFlowCanonicalJson $item
        }
        return '[' + ($parts -join ',') + ']'
    }

    if ($Value -is [bool]) { return $(if ($Value) { 'true' } else { 'false' }) }
    if ($Value -is [string] -or $Value -is [char]) { return ConvertTo-Json -InputObject ([string]$Value) -Compress }

    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    if ($Value -is [double]) { return $Value.ToString('R', $culture) }
    if ($Value -is [single]) { return $Value.ToString('R', $culture) }
    if ($Value -is [decimal]) { return $Value.ToString($culture) }
    if ($Value -is [byte] -or $Value -is [sbyte] -or
        $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int32] -or $Value -is [uint32] -or
        $Value -is [int64] -or $Value -is [uint64]) {
        return $Value.ToString($culture)
    }

    return ConvertTo-Json $Value -Compress -Depth 50
}

function Get-TradeFlowSha256Hex {
    param([Parameter(Mandatory=$true)][string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hash = $sha.ComputeHash($bytes)
        return -join ($hash | ForEach-Object { $_.ToString('x2') })
    }
    finally { $sha.Dispose() }
}

function New-TradeFlowNonce {
    $bytes = New-Object byte[] 18
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Get-TradeFlowHmacBase64 {
    param(
        [Parameter(Mandatory=$true)][string]$Material,
        [Parameter(Mandatory=$true)][string]$Secret
    )
    $key = [System.Text.Encoding]::UTF8.GetBytes($Secret)
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = $key
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Material)
        return [Convert]::ToBase64String($hmac.ComputeHash($bytes))
    }
    finally { $hmac.Dispose() }
}

function Invoke-TradeFlowSignedApi {
    param(
        [Parameter(Mandatory=$true)][string]$BaseUrl,
        [Parameter(Mandatory=$true)][string]$ApiToken,
        [Parameter(Mandatory=$true)][string]$BusinessId,
        [Parameter(Mandatory=$true)][string]$SigningSecret,
        [Parameter(Mandatory=$true)][string]$Action,
        [Parameter(Mandatory=$true)][hashtable]$Data,
        [string]$RequestId = ('tf-' + [guid]::NewGuid().ToString('N')),
        [string]$CorrelationId = ''
    )

    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $nonce = New-TradeFlowNonce
    $canonicalData = ConvertTo-TradeFlowCanonicalJson $Data
    $dataHash = Get-TradeFlowSha256Hex $canonicalData

    $material = @(
        'v1',
        $BusinessId,
        $RequestId,
        $CorrelationId,
        $Action,
        [string]$timestamp,
        $nonce,
        $dataHash
    ) -join "`n"

    $signature = Get-TradeFlowHmacBase64 -Material $material -Secret $SigningSecret

    $request = [ordered]@{
        version           = 'v1'
        action            = $Action
        request_id        = $RequestId
        business_id       = $BusinessId
        api_token         = $ApiToken
        request_timestamp = $timestamp
        request_nonce     = $nonce
        request_signature = $signature
        data              = $Data
    }
    if ($CorrelationId) { $request.correlation_id = $CorrelationId }

    $body = $request | ConvertTo-Json -Depth 50 -Compress

    Invoke-RestMethod `
        -Uri $BaseUrl `
        -Method POST `
        -ContentType 'application/json' `
        -Body $body
}

<#
Example after TRADEFLOW_PUBLIC_API_REQUIRE_SIGNATURE=true:

$baseUrl = 'YOUR_DEPLOYED_EXEC_URL'
$token = 'YOUR_HIGH_ENTROPY_API_TOKEN'
$businessId = 'YOUR_CONFIGURED_BUSINESS_ID'
$signingSecret = 'YOUR_INDEPENDENT_SIGNING_SECRET'

$result = Invoke-TradeFlowSignedApi `
    -BaseUrl $baseUrl `
    -ApiToken $token `
    -BusinessId $businessId `
    -SigningSecret $signingSecret `
    -Action 'catalogue.search' `
    -Data @{ shop_id = 'shop-main'; query = 'Anjoy' }

$result | ConvertTo-Json -Depth 30

Write retry rule:
- keep the same order/handover idempotency_key;
- generate a fresh HTTP request so request_id, timestamp, nonce and signature are fresh.
#>
