param([Parameter(Mandatory=$true)][string]$AppRepositoryPath, [switch]$ReplaceUnpublishedBuild)
$ErrorActionPreference = 'Stop'
$studioBuild = Join-Path $PSScriptRoot 'dist/elsa-workflows-studio'
$applicationRoot = (Resolve-Path -LiteralPath $AppRepositoryPath).Path
$destination = Join-Path $applicationRoot 'FinansysApp/App.Web/wwwroot/elsa-dashboard-journal3'
if (!(Test-Path -LiteralPath (Join-Path $studioBuild 'elsa-workflows-studio.esm.js'))) { throw 'Build the pinned Stencil distribution first.' }
if (!(Test-Path -LiteralPath (Join-Path $applicationRoot 'FinansysApp/App.Web/Web.Template.csproj'))) { throw 'Expected UniFi application repository.' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
# Generated artifacts, not a second runtime package. Fonts/images stay on the
# existing designer package; all JavaScript and global CSS come from one build.
$modules = Get-ChildItem -LiteralPath $studioBuild -File | Where-Object { $_.Extension -in '.js','.css' }
foreach ($module in $modules) {
    $target = Join-Path $destination $module.Name
    if (!$ReplaceUnpublishedBuild -and (Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath $module.FullName).Hash) {
        throw "Immutable artifact differs: $target. Use a new asset revision instead of overwriting an existing build."
    }
    Copy-Item -LiteralPath $module.FullName -Destination $target
}
# Ship the canonical adapter alongside this exact bundle even when the IIS
# pipeline skips the SPA build; otherwise an old adapter can survive redeploy.
$adapterSource = Join-Path $applicationRoot 'FinansysApp/App.Web/ClientApp/public/workflow-parameter-property.js'
$adapterTarget = Join-Path $destination 'workflow-parameter-property.js'
$adapterText = Get-Content -LiteralPath $adapterSource -Raw
foreach ($chunkMatch in [regex]::Matches($adapterText, "const (?:RUNTIME_CHUNK|MAPPER_CHUNK) = '([^']+)'")) {
    if (!(Test-Path -LiteralPath (Join-Path $studioBuild $chunkMatch.Groups[1].Value))) {
        throw "Update adapter imports to match this build: $($chunkMatch.Groups[1].Value) is missing."
    }
}
if (!$ReplaceUnpublishedBuild -and (Test-Path -LiteralPath $adapterTarget) -and (Get-FileHash -LiteralPath $adapterTarget).Hash -ne (Get-FileHash -LiteralPath $adapterSource).Hash) {
    throw 'Adapter differs from the immutable revision. Use a new revision.'
}
Copy-Item -LiteralPath $adapterSource -Destination $adapterTarget
Write-Output "Exported $($modules.Count) generated dashboard modules to $destination"
