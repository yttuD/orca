# Instala Skills complementarias solo al ejecutar este script manualmente.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
$env:DISABLE_TELEMETRY='1'
$groups = @(
  @{ Repo='obra/superpowers'; Skills=@('writing-plans','using-git-worktrees') }
  @{ Repo='mattpocock/skills'; Skills=@('domain-modeling','improve-codebase-architecture','tdd') }
  @{ Repo='anthropics/skills'; Skills=@('doc-coauthoring','skill-creator','frontend-design') }
  @{ Repo='vercel-labs/agent-browser'; Skills=@('agent-browser') }
  @{ Repo='openai/plugins'; Skills=@('uml-and-software-architecture-visualization') }
  @{ Repo='coreyhaines31/marketingskills'; Skills=@('product-marketing','copywriting','launch-strategy','pricing-strategy') }
)
foreach($g in $groups){ foreach($skill in $g.Skills) {
  & npx --yes skills add $g.Repo --skill $skill -a codex -a antigravity --copy -y
  if($LASTEXITCODE -ne 0){throw "No se pudo instalar $($g.Repo)/$skill"}
}}
Write-Host 'Comprueba .agents/skills y reinicia las sesiones de los agentes.'
