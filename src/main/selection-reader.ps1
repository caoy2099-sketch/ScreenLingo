$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$marker = 'SCREENLINGO_SELECTION:'

function Write-SelectionResult([bool]$ok, [string]$text, [string]$errorText) {
  if ($text.Length -gt 20000) {
    $text = $text.Substring(0, 20000)
  }
  if ($errorText.Length -gt 400) {
    $errorText = $errorText.Substring(0, 400)
  }
  $payload = @{
    ok = $ok
    text = $text
    error = $errorText
  } | ConvertTo-Json -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  Write-Output ($marker + [Convert]::ToBase64String($bytes))
}

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $element = [System.Windows.Automation.AutomationElement]::FocusedElement
  $selectedText = ''

  for ($depth = 0; $depth -lt 6 -and $null -ne $element; $depth++) {
    if ($element.Current.IsPassword) {
      Write-SelectionResult $false '' 'The active control is a password field.'
      exit 0
    }

    try {
      $patternObject = $null
      $hasTextPattern = $element.TryGetCurrentPattern(
        [System.Windows.Automation.TextPattern]::Pattern,
        [ref]$patternObject
      )
      if ($hasTextPattern -and $null -ne $patternObject) {
        $ranges = $patternObject.GetSelection()
        if ($null -ne $ranges -and $ranges.Count -gt 0) {
          $parts = @()
          foreach ($range in $ranges) {
            $part = $range.GetText(-1)
            if (-not [string]::IsNullOrWhiteSpace($part)) {
              $parts += $part
            }
          }
          $candidate = ($parts -join "`r`n").Trim()
          if ($candidate.Length -gt 0) {
            $selectedText = $candidate
            break
          }
        }
      }
    } catch {
      # Some controls expose a TextPattern that cannot answer GetSelection.
    }

    try {
      $element = $walker.GetParent($element)
    } catch {
      $element = $null
    }
  }

  if ($selectedText.Length -gt 0) {
    Write-SelectionResult $true $selectedText ''
  } else {
    Write-SelectionResult $false '' 'No selected text was exposed by the active control.'
  }
} catch {
  Write-SelectionResult $false '' $_.Exception.Message
}
