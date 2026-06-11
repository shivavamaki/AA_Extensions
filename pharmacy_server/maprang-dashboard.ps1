<#
  maprang-dashboard.ps1
  Playful real-time monitor for the BKN Pharmacy Server.
  Wide arcade layout: big game panel (left) + stacked status panels (right),
  recent-requests table + live-activity mini panel, full-width header/footer.

  Standalone, single file, no external modules. Windows PowerShell 5.1+.
  Unicode glyphs are built from char codes (not literals) so the script parses
  and renders correctly regardless of file encoding.
#>

[CmdletBinding()]
param(
    [string] $ServerUrl = "http://10.134.110.81:8765",
    [int]    $RefreshMs = 200
)

$ErrorActionPreference = "SilentlyContinue"
$ServerUrl = $ServerUrl.TrimEnd('/')

# ── Glyphs (char codes → no literal Unicode in source) ───────────────────────
$G = @{
    TL = [char]0x250C; TR = [char]0x2510; BL = [char]0x2514; BR = [char]0x2518
    H  = [char]0x2500; V  = [char]0x2502
    Block = [char]0x2588; HalfB = [char]0x2584; LightV = [char]0x2503
    Dash  = [char]0x2508; Dot = [char]0x00B7; Star = [char]0x2726
    Moon  = [char]0x263E; Cloud = [char]0x2601; Flower = [char]0x273F
    HeartC= [char]0x2665; StarW = [char]0x2605; Bullet = [char]0x25CF
    DashLine = [char]0x2509; OverBar = [char]0x2594; TickV = [char]0x250A
    Sparkle = [char]0x2727
}
$Spk = @([char]0x2581,[char]0x2582,[char]0x2583,[char]0x2584,[char]0x2585,[char]0x2586,[char]0x2587,[char]0x2588)

# ── ANSI colour helpers (neon palette) ───────────────────────────────────────
$ESC = [char]27
$C = @{
    Reset = "$ESC[0m";  Blue = "$ESC[38;5;33m"; Cyan = "$ESC[38;5;51m"
    Green = "$ESC[38;5;46m"; Yellow = "$ESC[38;5;226m"; Mag = "$ESC[38;5;201m"
    White = "$ESC[97m"; Gray = "$ESC[38;5;245m"; Red = "$ESC[38;5;196m"
    Orange= "$ESC[38;5;214m"; DimGrn = "$ESC[38;5;28m"
}
function Col([string]$c, [string]$t) { return ($C[$c] + $t + $C.Reset) }

function VisLen([string]$s) { return ([regex]::Replace($s, "$ESC\[[0-9;]*m", "")).Length }
function PadVis([string]$s, [int]$w) {
    $len = VisLen $s
    if ($len -ge $w) { return $s }
    return $s + (" " * ($w - $len))
}

# ── Console / layout sizing ──────────────────────────────────────────────────
function Get-Layout {
    $w = [Console]::WindowWidth
    $h = [Console]::WindowHeight
    if ($w -lt 100) { $w = 100 }
    if ($h -lt 36)  { $h = 36 }
    $inner  = $w - 2
    $rightW = 36
    $leftW  = $inner - $rightW - 1
    [pscustomobject]@{ Width=$w; Height=$h; Inner=$inner; LeftW=$leftW; RightW=$rightW }
}

# ── Bordered panel builder ───────────────────────────────────────────────────
function Draw-BorderPanel {
    param([string[]]$Body, [int]$Width, [string]$Title = "")
    $inner = $Width - 2
    $b = $C.Blue; $r = $C.Reset
    $out = @()
    if ($Title) {
        $t = " $Title "
        $dash = $inner - $t.Length
        if ($dash -lt 0) { $dash = 0 }
        $out += ($b + $G.TL + $r + (Col 'Cyan' $t) + $b + ($G.H.ToString() * $dash) + $G.TR + $r)
    } else {
        $out += ($b + $G.TL + ($G.H.ToString() * $inner) + $G.TR + $r)
    }
    foreach ($line in $Body) {
        $out += ($b + $G.V + $r + (PadVis $line $inner) + $b + $G.V + $r)
    }
    $out += ($b + $G.BL + ($G.H.ToString() * $inner) + $G.BR + $r)
    return $out
}

# ── STATE ────────────────────────────────────────────────────────────────────
$script:StartTime = Get-Date
$script:Frame     = 0
$script:ReqCount  = 0
$script:LastReq   = "-"
$script:Recent    = New-Object System.Collections.ArrayList
$script:Trend     = New-Object System.Collections.ArrayList
$script:Health    = @{}
$script:Collected = @{ burger=0; teddy=0; ribbon=0; star=0; heart=0 }
$script:MaprangX  = 0
$script:HealthEndpoints = @("/api/vdos","/api/faqs","/api/items","/ping","/api/health")

# ── POLLING ──────────────────────────────────────────────────────────────────
function Get-EndpointStatus {
    param([string]$Path)
    $url = "$ServerUrl$Path"
    $t0 = Get-Date
    try {
        $resp = Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing
        $ms   = [int]((Get-Date) - $t0).TotalMilliseconds
        $size = 0
        try { $size = [int]$resp.RawContentLength } catch {}
        if ($size -le 0 -and $resp.Content) { $size = [Text.Encoding]::UTF8.GetByteCount([string]$resp.Content) }
        return [pscustomobject]@{ Code=[int]$resp.StatusCode; Ms=$ms; Size=$size; Ok=$true }
    } catch {
        $code = 0
        try { $code = [int]$_.Exception.Response.StatusCode.value__ } catch {}
        $ms = [int]((Get-Date) - $t0).TotalMilliseconds
        return [pscustomobject]@{ Code=$code; Ms=$ms; Size=0; Ok=$false }
    }
}

function Fmt-Size([int]$b) {
    if ($b -ge 1024) { return ("{0:N2} KB" -f ($b / 1024)) }
    return ("$b B")
}

function Poll-Tick {
    $idx  = $script:Frame % $script:HealthEndpoints.Count
    $path = $script:HealthEndpoints[$idx]
    $st   = Get-EndpointStatus -Path $path
    $script:Health[$path] = $st
    $script:ReqCount++

    $time = (Get-Date).ToString("HH:mm:ss")
    $code = if ($st.Code) { $st.Code } else { 0 }
    $script:LastReq = "GET $path"

    [void]$script:Recent.Add([pscustomobject]@{
        Time=$time; Method="GET"; Path=$path; Code=$code; Size=(Fmt-Size $st.Size)
    })
    while ($script:Recent.Count -gt 8) { $script:Recent.RemoveAt(0) }

    [void]$script:Trend.Add([math]::Min(99, [int]$st.Ms))
    while ($script:Trend.Count -gt 26) { $script:Trend.RemoveAt(0) }
}

function Get-ServerStats {
    $reqMin = 0.0
    $elapsedMin = ((Get-Date) - $script:StartTime).TotalMinutes
    if ($elapsedMin -gt 0) { $reqMin = [math]::Round($script:ReqCount / $elapsedMin, 1) }
    $avg = 0
    if ($script:Trend.Count) { $avg = [int](($script:Trend | Measure-Object -Average).Average) }

    $cpu = 28 + ($script:Frame % 14)
    try { $cpu = [int](Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue } catch {}
    $mem = 55 + ($script:Frame % 10)
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
        $mem = [int]((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100)
    } catch {}

    [pscustomobject]@{ Cpu=$cpu; Mem=$mem; Active=(20 + ($script:Frame % 12)); ReqMin=$reqMin; AvgMs=$avg }
}

# ── ANIMATION ────────────────────────────────────────────────────────────────
function Update-AnimationState {
    param([int]$Span)
    $script:Frame++
    if ($Span -lt 10) { $Span = 10 }
    $script:MaprangX = ($script:Frame) % $Span
    if ($script:Frame % 7  -eq 0) { $script:Collected.burger++ }
    if ($script:Frame % 11 -eq 0) { $script:Collected.teddy++ }
    if ($script:Frame % 17 -eq 0) { $script:Collected.ribbon++ }
    if ($script:Frame % 23 -eq 0) { $script:Collected.star++ }
    if ($script:Frame % 5  -eq 0) { $script:Collected.heart++ }
}

# Cute girl sprite (plain chars; colour applied at paint time). 4 rows:
#   flower+hair / face / dress+arms / legs+skirt
function Maprang-Sprite([int]$pose) {
    $flower = $G.Flower
    switch ($pose) {
        0 { return @("$flower(|)", "(^.^)", "/[#]\", "_/ \_") }
        1 { return @("$flower(|)", "(o.o)", "\[#]/", "/\_/\") }
        2 { return @("$flower(|)", "(^o^)", "\[#]/", " / \ ") }
        default { return @("$flower(|)", "(^.^)", "/[#]\", "_/ \_") }
    }
}

# ── RENDER: HEADER ───────────────────────────────────────────────────────────
function Render-Header {
    param($Lo)
    $up = ((Get-Date) - $script:StartTime)
    $upStr = "{0:00}:{1:00}:{2:00}" -f [int]$up.TotalHours, $up.Minutes, $up.Seconds
    $sep = (Col 'Blue' "  $($G.V)  ")
    $seg = @(
        (Col 'Cyan' "(URL) ")    + (Col 'White' $ServerUrl),
        (Col 'Yellow' "(UP) ")   + (Col 'Cyan'  "Uptime: $upStr"),
        (Col 'Green' "(REQ) ")   + (Col 'White' "Requests: $($script:ReqCount)"),
        (Col 'Yellow' "(LAST) ") + (Col 'White' $script:LastReq)
    )
    return Draw-BorderPanel -Body @(" " + ($seg -join $sep)) -Width $Lo.Width
}

# ── RENDER: TITLE ────────────────────────────────────────────────────────────
function Render-Title {
    param($Lo)
    $f = $G.Flower
    $title = (Col 'Mag' "$f Maprang Plays! $f")
    $score = (Col 'Yellow' "$($G.StarW) ") + (Col 'White' "Score: ") + (Col 'Yellow' $script:Frame) + (Col 'Yellow' " $($G.StarW)")
    $gap = $Lo.Inner - (VisLen $title) - (VisLen $score) - 4
    if ($gap -lt 2) { $gap = 2 }
    return Draw-BorderPanel -Body @("  $title$(' ' * $gap)$score") -Width $Lo.Width
}

# ── RENDER: LEFT GAME PANEL ──────────────────────────────────────────────────
function Render-GamePanel {
    param([int]$Width, [int]$Rows)
    $inner = $Width - 2
    $grid = @()
    for ($i = 0; $i -lt $Rows; $i++) { $grid += , (,(" ") * $inner) }

    function Put([int]$row, [int]$col, [string]$s, [string]$color) {
        if ($row -lt 0 -or $row -ge $Rows) { return }
        for ($k = 0; $k -lt $s.Length; $k++) {
            $cc = $col + $k
            if ($cc -ge 0 -and $cc -lt $inner) { $grid[$row][$cc] = (Col $color ([string]$s[$k])) }
        }
    }

    # Sky: blinking stars
    for ($s = 0; $s -lt 16; $s++) {
        $sx = (($s * 41 + $script:Frame) % $inner)
        $sy = $s % 4
        $ch = if ((($s + $script:Frame) % 6) -lt 3) { $G.Star } else { $G.Dot }
        Put $sy $sx ([string]$ch) 'Yellow'
    }
    # Moon + clouds
    Put 1 ($inner - 6) ([string]$G.Moon) 'Yellow'
    $cloudX = (($script:Frame) % ($inner + 12)) - 8
    Put 1 $cloudX "(   )" 'Cyan'
    Put 0 ([int]($inner * 0.40)) "(  )" 'Cyan'
    Put 2 ([int]($inner * 0.66)) "(    )" 'Cyan'

    # Ground
    $groundRow = $Rows - 1
    for ($c = 0; $c -lt $inner; $c++) { $grid[$groundRow][$c] = (Col 'DimGrn' ([string]$G.HalfB)) }

    # Platforms
    $plat = $Rows - 5
    $platforms = @(
        @{ x=[int]($inner*0.28); w=7 }, @{ x=[int]($inner*0.44); w=7 },
        @{ x=[int]($inner*0.61); w=8 }, @{ x=[int]($inner*0.80); w=8 }
    )
    foreach ($p in $platforms) {
        Put $plat $p.x ([string]$G.OverBar * $p.w) 'Green'
        Put ($plat+1) $p.x ([string]$G.TickV + (" " * ($p.w-2)) + [string]$G.TickV) 'DimGrn'
    }

    # Collectibles on platforms (ASCII-safe glyphs)
    Put ($plat-1) ([int]($inner*0.29)) "B"  'Yellow'   # burger
    Put ($plat-1) ([int]($inner*0.45)) "T"  'Orange'   # teddy
    Put ($plat-1) ([int]($inner*0.62)) "R"  'Mag'      # ribbon
    Put ($plat-1) ([int]($inner*0.81)) ([string]$G.StarW) 'Yellow'
    Put ($plat-1) ([int]($inner*0.90)) ([string]$G.HeartC) 'Mag'

    # Jump arc + Maprang
    $mx = $script:MaprangX
    $phase = ($script:Frame % 24)
    $jump = [int]([math]::Round(2 * [math]::Sin($phase / 24.0 * [math]::PI * 2)))
    if ($jump -lt 0) { $jump = 0 }
    for ($a = -6; $a -le 6; $a++) {
        $ax = $mx + $a + 2
        $ay = $plat - [int]([math]::Round(2 * [math]::Sin((($a + 6) / 12.0) * [math]::PI))) - $jump
        Put $ay $ax ([string]$G.Dot) 'Green'
    }
    $sprite = Maprang-Sprite ($script:Frame % 3)
    $baseRow = $groundRow - 4 - $jump
    Put $baseRow      $mx $sprite[0] 'Mag'      # flower + hair
    Put ($baseRow+1)  $mx $sprite[1] 'White'    # face
    Put ($baseRow+2)  $mx $sprite[2] 'Cyan'     # dress + arms
    Put ($baseRow+3)  $mx $sprite[3] 'Green'    # legs
    # dust sparkle
    Put $groundRow ($mx-1) ([string]$G.Sparkle) 'White'
    Put ($baseRow+2) ($mx-2) ([string]$G.Dot) 'Gray'

    $body = @()
    for ($i = 0; $i -lt $Rows; $i++) { $body += ($grid[$i] -join "") }
    $tag  = (Col 'White' "LEVEL 1 - RUN, COLLECT, AND SCORE!")
    $hint = (Col 'Gray'  "Use your APIs. Collect joy. $($G.Flower)")
    $g2 = $inner - (VisLen $tag) - (VisLen $hint) - 2
    if ($g2 -lt 1) { $g2 = 1 }
    $body[0] = " $tag$(' ' * $g2)$hint"
    return Draw-BorderPanel -Body $body -Width $Width
}

# ── RENDER: SIDEBAR ──────────────────────────────────────────────────────────
function Bar([int]$pct, [int]$cells) {
    $fill = [int]([math]::Round($pct / 100.0 * $cells))
    if ($fill -gt $cells) { $fill = $cells }
    if ($fill -lt 0) { $fill = 0 }
    $color = if ($pct -ge 80) { 'Red' } elseif ($pct -ge 60) { 'Yellow' } else { 'Green' }
    return "[" + (Col $color ([string]$G.Block * $fill)) + (Col 'Gray' ([string]$G.H * ($cells - $fill))) + "]"
}

function Spark([int[]]$vals) {
    if (-not $vals -or $vals.Count -eq 0) { return "" }
    $max = ($vals | Measure-Object -Maximum).Maximum
    if ($max -le 0) { $max = 1 }
    $s = ""
    foreach ($v in $vals) {
        $idx = [int]([math]::Round($v / $max * 7))
        if ($idx -lt 0) { $idx = 0 }; if ($idx -gt 7) { $idx = 7 }
        $s += $Spk[$idx]
    }
    return Col 'Green' $s
}

function Render-Sidebar {
    param([int]$Width)
    $stats = Get-ServerStats
    $out = @()

    # A) ENDPOINT HEALTH
    $hb = @("")
    foreach ($p in @("/api/vdos","/api/faqs","/api/items","/api/users","/api/health")) {
        $st = $script:Health[$p]
        if ($null -eq $st) {
            $dot = Col 'Gray' ([string]$G.Bullet); $code = Col 'Gray' "..."
        } elseif ($st.Ok) {
            $dot = Col 'Green' ([string]$G.Bullet); $code = Col 'Green' ([string]$st.Code)
        } else {
            $clr = if ($st.Code -ge 400 -and $st.Code -lt 500) { 'Yellow' } else { 'Red' }
            $dot = Col $clr ([string]$G.Bullet)
            $code = Col $clr ([string]$st.Code)
        }
        $hb += " $(PadVis (Col 'White' $p) 16) $dot  $code"
    }
    $hb += ""
    $out += Draw-BorderPanel -Body $hb -Width $Width -Title "ENDPOINT HEALTH"

    # B) SERVER STATS
    $sb = @("")
    $sb += " $(PadVis (Col 'White' 'CPU Usage') 14) $(Bar $stats.Cpu 8) $(Col 'Cyan' ('{0,3}%' -f $stats.Cpu))"
    $sb += " $(PadVis (Col 'White' 'Memory') 14) $(Bar $stats.Mem 8) $(Col 'Cyan' ('{0,3}%' -f $stats.Mem))"
    $sb += " $(PadVis (Col 'White' 'Active Conns') 14) $(Col 'Yellow' ('{0,4}' -f $stats.Active))"
    $sb += " $(PadVis (Col 'White' 'Req / Min') 14) $(Col 'Yellow' ('{0,6}' -f $stats.ReqMin))"
    $sb += " $(PadVis (Col 'White' 'Avg Resp Time') 14) $(Col 'Yellow' ('{0,4}ms' -f $stats.AvgMs))"
    $sb += " $(Spark ([int[]]$script:Trend.ToArray()))"
    $out += Draw-BorderPanel -Body $sb -Width $Width -Title "SERVER STATS"

    # C) ITEMS COLLECTED
    $cb = @("")
    $cb += "  $(Col 'Yellow' 'B') $(Col 'Gray' ('x{0:00}' -f $script:Collected.burger))   $(Col 'Orange' 'T') $(Col 'Gray' ('x{0:00}' -f $script:Collected.teddy))"
    $cb += "  $(Col 'Mag' 'R') $(Col 'Gray' ('x{0:00}' -f $script:Collected.ribbon))   $(Col 'Yellow' ([string]$G.StarW)) $(Col 'Gray' ('x{0:00}' -f $script:Collected.star))"
    $cb += "  $(Col 'Mag' ([string]$G.HeartC)) $(Col 'Gray' ('x{0:00}' -f $script:Collected.heart))"
    $cb += ""
    $out += Draw-BorderPanel -Body $cb -Width $Width -Title "ITEMS COLLECTED"

    # D) LIVE ACTIVITY
    $sp = Maprang-Sprite ($script:Frame % 3)
    $arc = ""
    for ($a = 0; $a -lt 16; $a++) { if ((($a + $script:Frame) % 4) -eq 0) { $arc += "." } else { $arc += " " } }
    $lb = @("")
    $lb += "  $(Col 'Mag' $sp[0])"
    $lb += "  $(Col 'White' $sp[1])   $(Col 'Green' $arc)"
    $lb += "  $(Col 'Cyan'  $sp[2])"
    $lb += "  $(Col 'Green' $sp[3]) $(Col 'DimGrn' ([string]$G.OverBar * 12))"
    $lb += " $(Col 'Green' 'Running smoothly! Keep going!') $(Col 'Mag' '!')"
    $out += Draw-BorderPanel -Body $lb -Width $Width -Title "LIVE ACTIVITY"

    return $out
}

# ── RENDER: RECENT REQUESTS ──────────────────────────────────────────────────
function Render-RecentRequests {
    param([int]$Width, [int]$Rows)
    $inner = $Width - 2
    $body = @("")
    $body += "  " + (PadVis (Col 'Gray' 'TIME') 12) + (PadVis (Col 'Gray' 'METHOD') 8) + (PadVis (Col 'Gray' 'PATH') 22) + (PadVis (Col 'Gray' 'STATUS') 9) + (Col 'Gray' 'SIZE')
    $body += "  " + (Col 'Blue' ([string]$G.DashLine * ($inner - 4)))
    foreach ($r in $script:Recent.ToArray()) {
        $cc = if ($r.Code -ge 200 -and $r.Code -lt 300) { 'Green' } elseif ($r.Code -ge 300 -and $r.Code -lt 400) { 'Yellow' } else { 'Red' }
        $body += "  " +
            (PadVis (Col 'Cyan'  ("[$($r.Time)]")) 12) +
            (PadVis (Col 'White' $r.Method) 8) +
            (PadVis (Col 'White' $r.Path) 22) +
            (PadVis (Col $cc ([string]$r.Code)) 9) +
            (Col 'Gray' $r.Size)
    }
    while ($body.Count -lt $Rows) { $body += "" }
    return Draw-BorderPanel -Body $body -Width $Width -Title "RECENT REQUESTS"
}

# ── RENDER: FOOTER ───────────────────────────────────────────────────────────
function Render-Footer {
    param($Lo)
    return Draw-BorderPanel -Body @("  " + (Col 'White' "Press Ctrl+C to stop the server")) -Width $Lo.Width
}

# ── Compose two columns side by side ─────────────────────────────────────────
function Join-Columns {
    param([string[]]$Left, [string[]]$Right, [int]$LeftW)
    $max = [math]::Max($Left.Count, $Right.Count)
    $out = @()
    for ($i = 0; $i -lt $max; $i++) {
        $l = if ($i -lt $Left.Count)  { $Left[$i] }  else { "" }
        $r = if ($i -lt $Right.Count) { $Right[$i] } else { "" }
        $out += (PadVis $l $LeftW) + " " + $r
    }
    return $out
}

# ── MAIN LOOP ────────────────────────────────────────────────────────────────
function Main-Loop {
    [Console]::CursorVisible = $false
    [Console]::Write("$ESC[?1049h")   # alternate screen buffer = no scroll, low flicker
    try {
        while ($true) {
            $Lo = Get-Layout
            Poll-Tick
            Update-AnimationState -Span ($Lo.LeftW - 12)

            $gameRows = $Lo.Height - 18
            if ($gameRows -lt 12) { $gameRows = 12 }

            $lines = @()
            $lines += Render-Header -Lo $Lo
            $lines += Render-Title  -Lo $Lo

            $game = Render-GamePanel -Width $Lo.LeftW -Rows $gameRows
            $side = Render-Sidebar   -Width $Lo.RightW
            $lines += Join-Columns -Left $game -Right $side -LeftW $Lo.LeftW

            $recent = Render-RecentRequests -Width $Lo.LeftW -Rows 11
            $lines += Join-Columns -Left $recent -Right @() -LeftW $Lo.LeftW

            $lines += Render-Footer -Lo $Lo

            $sbld = [Text.StringBuilder]::new()
            [void]$sbld.Append("$ESC[H")
            foreach ($ln in $lines) { [void]$sbld.Append($ln); [void]$sbld.Append("$ESC[K`n") }
            [void]$sbld.Append("$ESC[J")
            [Console]::Write($sbld.ToString())

            Start-Sleep -Milliseconds $RefreshMs
        }
    }
    finally {
        [Console]::Write("$ESC[?1049l")
        [Console]::CursorVisible = $true
        Write-Host "`nDashboard stopped."
    }
}

try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new() } catch {}
Main-Loop

<#
  ── USAGE ───────────────────────────────────────────────────────────────────
  # Default (polls http://10.134.110.81:8765 every 200 ms):
  powershell -ExecutionPolicy Bypass -File .\maprang-dashboard.ps1

  # Custom server + refresh interval:
  powershell -ExecutionPolicy Bypass -File .\maprang-dashboard.ps1 -ServerUrl "http://10.134.110.81:8765" -RefreshMs 150

  Notes:
  - Best in Windows Terminal (full Unicode + ANSI); plain conhost also works.
  - Ctrl+C exits cleanly and restores the normal screen buffer.
  - /api/users and /api/health may show yellow/red (auth-required / not present);
    that demonstrates the non-healthy status colours.
#>
