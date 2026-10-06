# Windows UI Automation Agent for Boosty Chat Overlay QA
# Runs in the interactive desktop session (Session > 0) and exposes UIA operations over TCP 17380 (forwarded to host 127.0.0.1:17380)

$ErrorActionPreference = "Continue"
if (-not (Test-Path "Y:\")) { try { net use Y: "\\VBOXSVR\qa-share" /persistent:yes 2>&1 | Out-Null } catch {} }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32UiaHelper {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;

    public static void ClickPoint(int x, int y) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(40);
        mouse_event(MOUSEEVENTF_LEFTDOWN, (uint)x, (uint)y, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(40);
        mouse_event(MOUSEEVENTF_LEFTUP, (uint)x, (uint)y, 0, UIntPtr.Zero);
    }
}
"@

# Ensure shared folder Y: is mapped in this session
if (-not (Test-Path "Y:\")) {
    try {
        net use Y: "\\VBOXSVR\qa-share" /persistent:yes 2>&1 | Out-Null
    } catch {}
}

function Get-ElementRect($el) {
    try {
        $r = $el.Current.BoundingRectangle
        if ($r.IsEmpty -or [double]::IsInfinity($r.Width) -or [double]::IsNaN($r.Width)) {
            return $null
        }
        return @{
            x = [int]$r.X
            y = [int]$r.Y
            width = [int]$r.Width
            height = [int]$r.Height
        }
    } catch {
        return $null
    }
}

function Get-SupportedPatternNames($el) {
    $names = @()
    try {
        foreach ($p in $el.GetSupportedPatterns()) {
            $names += ($p.ProgrammaticName -replace "PatternIdentifiers\.Pattern$", "")
        }
    } catch {}
    return $names
}

function Find-TargetWindow($params) {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $handleFilter = $params.handle
    $titleFilter = $params.window_title
    $procFilter = $params.process_name
    $classFilter = $params.class_name

    foreach ($win in $children) {
        try {
            $cur = $win.Current
            if ($handleFilter -and ([int]$cur.NativeWindowHandle -eq [int]$handleFilter)) {
                return $win
            }
            $procName = ""
            if ($cur.ProcessId -gt 0) {
                try { $procName = (Get-Process -Id $cur.ProcessId -ErrorAction SilentlyContinue).ProcessName } catch {}
            }
            $match = $true
            if ($titleFilter) {
                if (-not $cur.Name -or ($cur.Name -notmatch [regex]::Escape($titleFilter) -and $cur.Name -notmatch $titleFilter)) {
                    $match = $false
                }
            }
            if ($procFilter) {
                if (-not $procName -or ($procName -notmatch $procFilter)) {
                    $match = $false
                }
            }
            if ($classFilter) {
                if (-not $cur.ClassName -or ($cur.ClassName -notmatch $classFilter)) {
                    $match = $false
                }
            }
            if ($match -and ($titleFilter -or $procFilter -or $classFilter)) {
                return $win
            }
        } catch {}
    }
    return $null
}

function Build-UiTree($el, [int]$depth, [int]$maxDepth) {
    if ($null -eq $el -or $depth -gt $maxDepth) { return $null }
    try {
        $cur = $el.Current
        $ctrlType = $cur.ControlType.ProgrammaticName -replace "^ControlType\.", ""
        $valText = $null
        try {
            $vp = $null
            if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
                $valText = $vp.Current.Value
            }
        } catch {}

        $node = [ordered]@{
            name = $cur.Name
            controlType = $ctrlType
            automationId = $cur.AutomationId
            className = $cur.ClassName
            handle = $cur.NativeWindowHandle
            isEnabled = $cur.IsEnabled
            isOffscreen = $cur.IsOffscreen
            value = $valText
            rect = Get-ElementRect $el
            patterns = Get-SupportedPatternNames $el
        }

        if ($depth -lt $maxDepth) {
            $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
            $child = $walker.GetFirstChild($el)
            $childrenList = @()
            $count = 0
            while ($null -ne $child -and $count -lt 80) {
                $childNode = Build-UiTree $child ($depth + 1) $maxDepth
                if ($null -ne $childNode) {
                    $childrenList += $childNode
                }
                $child = $walker.GetNextSibling($child)
                $count++
            }
            if ($childrenList.Count -gt 0) {
                $node["children"] = $childrenList
            }
        }
        return $node
    } catch {
        return $null
    }
}

function Find-MatchingDescendant($rootEl, $params, [int]$depth = 0, [int]$maxDepth = 7) {
    if ($null -eq $rootEl -or $depth -gt $maxDepth) { return $null }
    $nameFilter = $params.name
    $autoIdFilter = $params.automation_id
    $ctrlFilter = $params.control_type
    $classFilter = $params.element_class

    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($rootEl)
    $count = 0
    while ($null -ne $child -and $count -lt 100) {
        try {
            $cur = $child.Current
            $ctrlType = $cur.ControlType.ProgrammaticName -replace "^ControlType\.", ""
            $ok = $true
            if ($nameFilter) {
                if (-not $cur.Name -or ($cur.Name -ne $nameFilter -and $cur.Name -notmatch [regex]::Escape($nameFilter) -and $cur.Name -notmatch $nameFilter)) {
                    $ok = $false
                }
            }
            if ($autoIdFilter) {
                if ($cur.AutomationId -ne $autoIdFilter) {
                    $ok = $false
                }
            }
            if ($ctrlFilter) {
                if ($ctrlType -ne $ctrlFilter) {
                    $ok = $false
                }
            }
            if ($classFilter) {
                if ($cur.ClassName -notmatch $classFilter) {
                    $ok = $false
                }
            }
            if ($ok -and ($nameFilter -or $autoIdFilter -or $ctrlFilter -or $classFilter)) {
                return $child
            }
            $sub = Find-MatchingDescendant $child $params ($depth + 1) $maxDepth
            if ($null -ne $sub) {
                return $sub
            }
        } catch {}
        $child = $walker.GetNextSibling($child)
        $count++
    }
    return $null
}

function Invoke-Action($action, $params) {
    switch ($action) {
        "health" {
            $proc = Get-Process -Id $PID
            $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
            $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            return @{
                ok = $true
                status = "ready"
                sessionId = $proc.SessionId
                pid = $PID
                user = [System.Environment]::UserName
                computer = [System.Environment]::MachineName
                isElevated = $isAdmin
                uiaAvailable = ($null -ne [System.Windows.Automation.AutomationElement]::RootElement)
                screen = @{ width = $bounds.Width; height = $bounds.Height }
                sharedFolderMounted = ((Test-Path "Y:\") -or (Test-Path "\\VBOXSVR\qa-share"))
            }
        }

        "list_windows" {
            $root = [System.Windows.Automation.AutomationElement]::RootElement
            $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
            $result = @()
            foreach ($win in $children) {
                try {
                    $cur = $win.Current
                    if ([string]::IsNullOrWhiteSpace($cur.Name) -and $cur.ClassName -ne "CabinetWClass") {
                        continue
                    }
                    $procName = ""
                    if ($cur.ProcessId -gt 0) {
                        try { $procName = (Get-Process -Id $cur.ProcessId -ErrorAction SilentlyContinue).ProcessName } catch {}
                    }
                    $result += [ordered]@{
                        handle = $cur.NativeWindowHandle
                        title = $cur.Name
                        className = $cur.ClassName
                        processId = $cur.ProcessId
                        processName = $procName
                        controlType = ($cur.ControlType.ProgrammaticName -replace "^ControlType\.", "")
                        isOffscreen = $cur.IsOffscreen
                        rect = Get-ElementRect $win
                    }
                } catch {}
            }
            return @{ ok = $true; windows = $result }
        }

        "get_ui_tree" {
            $win = Find-TargetWindow $params
            if ($null -eq $win) {
                return @{ ok = $false; error = "Target window not found" }
            }
            $maxDepth = if ($params.max_depth) { [int]$params.max_depth } else { 4 }
            $tree = Build-UiTree $win 0 $maxDepth
            return @{ ok = $true; tree = $tree }
        }

        "launch_app" {
            $filePath = $params.path
            if (-not $filePath) {
                return @{ ok = $false; error = "Missing 'path' parameter" }
            }
            $argList = $params.args
            $workDir = $params.cwd
            $waitSec = if ($null -ne $params.wait_window_sec) { [int]$params.wait_window_sec } else { 3 }

            # Fire GUI process asynchronously in a background runspace so that modal ShellExecuteEx
            # security dialogs (MOTW Zone.Identifier, SmartScreen, UAC) NEVER block the single-threaded HTTP listener loop!
            $jobScript = {
                param($path, $args, $dir)
                try {
                    $psi = New-Object System.Diagnostics.ProcessStartInfo
                    $psi.FileName = $path
                    if ($args -and $args.Count -gt 0) {
                        $psi.Arguments = [string]::Join(" ", $args)
                    }
                    if ($dir) { $psi.WorkingDirectory = $dir }
                    $psi.UseShellExecute = $true
                    $p = [System.Diagnostics.Process]::Start($psi)
                    if ($p) { return $p.Id }
                } catch {
                    return 0
                }
                return 0
            }

            $psInstance = [PowerShell]::Create().AddScript($jobScript).AddArgument($filePath).AddArgument($argList).AddArgument($workDir)
            $asyncResult = $psInstance.BeginInvoke()

            # Wait briefly for process spawn (up to 1.5s), but do not hang if a modal dialog stops it from returning
            $spawnDeadline = (Get-Date).AddSeconds(1.5)
            $launchedPid = 0
            while ((Get-Date) -lt $spawnDeadline) {
                if ($asyncResult.IsCompleted) {
                    try {
                        $res = $psInstance.EndInvoke($asyncResult)
                        if ($res -is [int] -and $res -gt 0) {
                            $launchedPid = $res
                        }
                    } catch {}
                    break
                }
                Start-Sleep -Milliseconds 100
            }

            # If direct PID was not returned within 1.5s (e.g. ShellExecute dialog displayed),
            # search for recently spawned process matching the executable name:
            if ($launchedPid -eq 0) {
                $baseName = [System.IO.Path]::GetFileNameWithoutExtension($filePath)
                try {
                    $candidate = Get-Process -Name $baseName -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1
                    if ($candidate) {
                        $launchedPid = $candidate.Id
                    }
                } catch {}
            }

            # Window poll: separate polling loop up to $waitSec
            $deadline = (Get-Date).AddSeconds($waitSec)
            $mainTitle = ""
            $mainHandle = 0
            $procName = ""

            if ($launchedPid -gt 0) {
                try {
                    $p = Get-Process -Id $launchedPid -ErrorAction SilentlyContinue
                    if ($p) { $procName = $p.ProcessName }
                } catch {}
            }

            while ((Get-Date) -lt $deadline) {
                if ($launchedPid -gt 0) {
                    try {
                        $p = Get-Process -Id $launchedPid -ErrorAction SilentlyContinue
                        if ($p -and $p.MainWindowHandle -ne 0) {
                            $mainTitle = $p.MainWindowTitle
                            $mainHandle = [int]$p.MainWindowHandle
                            $procName = $p.ProcessName
                            break
                        }
                    } catch {}
                }
                Start-Sleep -Milliseconds 250
            }

            return @{
                ok = $true
                pid = $launchedPid
                processName = $procName
                mainWindowHandle = $mainHandle
                mainWindowTitle = $mainTitle
            }
        }

        "focus_window" {
            $win = Find-TargetWindow $params
            if ($null -eq $win) {
                return @{ ok = $false; error = "Target window not found" }
            }
            $hwnd = [IntPtr]$win.Current.NativeWindowHandle
            if ([Win32UiaHelper]::IsIconic($hwnd)) {
                [Win32UiaHelper]::ShowWindow($hwnd, 9) | Out-Null
            }
            [Win32UiaHelper]::SetForegroundWindow($hwnd) | Out-Null
            try { $win.SetFocus() } catch {}
            return @{
                ok = $true
                handle = $win.Current.NativeWindowHandle
                title = $win.Current.Name
            }
        }

        "click_element" {
            $win = Find-TargetWindow $params
            if ($null -eq $win) {
                return @{ ok = $false; error = "Target window not found" }
            }
            $hwnd = [IntPtr]$win.Current.NativeWindowHandle
            if ($hwnd -ne [IntPtr]::Zero) {
                if ([Win32UiaHelper]::IsIconic($hwnd)) {
                    [Win32UiaHelper]::ShowWindow($hwnd, 9) | Out-Null
                }
                [Win32UiaHelper]::SetForegroundWindow($hwnd) | Out-Null
                Start-Sleep -Milliseconds 100
            }
            $el = Find-MatchingDescendant $win $params
            if ($null -eq $el) {
                return @{ ok = $false; error = "Element not found in window '$($win.Current.Name)'" }
            }

            $elName = $el.Current.Name
            $elAutoId = $el.Current.AutomationId
            $elCtrl = ($el.Current.ControlType.ProgrammaticName -replace "^ControlType\.", "")
            $rect = Get-ElementRect $el

            $methodUsed = "none"
            $togPattern = $null
            $selPattern = $null
            $invPattern = $null

            if ($null -ne $rect -and $rect.width -gt 0 -and $rect.height -gt 0 -and (-not $params.use_invoke_pattern)) {
                $cx = [int]($rect.x + ($rect.width / 2))
                $cy = [int]($rect.y + ($rect.height / 2))
                [Win32UiaHelper]::ClickPoint($cx, $cy)
                $methodUsed = "UIA+BoundingRectClick($cx,$cy)"
            } elseif ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$togPattern)) {
                $togPattern.Toggle()
                $methodUsed = "TogglePattern"
            } elseif ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selPattern)) {
                $selPattern.Select()
                $methodUsed = "SelectionItemPattern"
            } elseif ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invPattern)) {
                $invPattern.Invoke()
                $methodUsed = "InvokePattern"
            } else {
                return @{ ok = $false; error = "Element '$elName' cannot be clicked or invoked" }
            }

            return @{
                ok = $true
                method = $methodUsed
                elementName = $elName
                automationId = $elAutoId
                controlType = $elCtrl
                rect = $rect
            }
        }

        "set_text" {
            $win = Find-TargetWindow $params
            if ($null -eq $win) {
                return @{ ok = $false; error = "Target window not found" }
            }
            $hwnd = [IntPtr]$win.Current.NativeWindowHandle
            if ($hwnd -ne [IntPtr]::Zero) {
                [Win32UiaHelper]::SetForegroundWindow($hwnd) | Out-Null
            }

            $text = [string]$params.text
            $el = $null
            if ($params.name -or $params.automation_id -or $params.control_type -or $params.element_class) {
                $el = Find-MatchingDescendant $win $params
            } else {
                $el = Find-MatchingDescendant $win @{ control_type = "Edit" }
                if ($null -eq $el) {
                    $el = Find-MatchingDescendant $win @{ control_type = "Document" }
                }
            }

            $methodUsed = "none"
            if ($null -ne $el) {
                $valPattern = $null
                if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valPattern) -and -not $valPattern.Current.IsReadOnly) {
                    $valPattern.SetValue($text)
                    $methodUsed = "ValuePattern"
                } else {
                    try { $el.SetFocus() } catch {}
                    Start-Sleep -Milliseconds 150
                    [System.Windows.Forms.SendKeys]::SendWait($text)
                    $methodUsed = "FocusAndSendKeys"
                }
            } else {
                try { $win.SetFocus() } catch {}
                Start-Sleep -Milliseconds 150
                [System.Windows.Forms.SendKeys]::SendWait($text)
                $methodUsed = "WindowSendKeys"
            }

            return @{
                ok = $true
                method = $methodUsed
                windowTitle = $win.Current.Name
            }
        }

        "send_keys" {
            if ($params.window_title -or $params.handle -or $params.process_name) {
                $win = Find-TargetWindow $params
                if ($null -ne $win) {
                    $hwnd = [IntPtr]$win.Current.NativeWindowHandle
                    [Win32UiaHelper]::SetForegroundWindow($hwnd) | Out-Null
                    try { $win.SetFocus() } catch {}
                    Start-Sleep -Milliseconds 150
                }
            }
            [System.Windows.Forms.SendKeys]::SendWait([string]$params.keys)
            return @{ ok = $true; keys = $params.keys }
        }

        "close_window" {
            $win = Find-TargetWindow $params
            if ($null -eq $win) {
                if ($params.force -and $params.process_name) {
                    Get-Process -Name $params.process_name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
                    return @{ ok = $true; closedWindow = $null; method = "Stop-Process" }
                }
                return @{ ok = $false; error = "Target window not found" }
            }
            $winTitle = $win.Current.Name
            $procId = $win.Current.ProcessId
            $winPattern = $null
            $closedBy = "none"
            if (-not $params.force -and $win.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$winPattern)) {
                try {
                    $winPattern.Close()
                    $closedBy = "WindowPattern.Close"
                } catch {}
            }
            if ($params.force -and $procId -gt 0) {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                $closedBy = "Stop-Process"
            }
            return @{
                ok = $true
                closedWindow = $winTitle
                processId = $procId
                method = $closedBy
            }
        }

        default {
            return @{ ok = $false; error = "Unknown action: $action" }
        }
    }
}

$port = 17380
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
$listener.Start()
Write-Host "Windows UI Automation Agent listening on port $port (Session $((Get-Process -Id $PID).SessionId))"

while ($true) {
    $client = $null
    try {
        $client = $listener.AcceptTcpClient()
        $client.ReceiveTimeout = 15000
        $client.SendTimeout = 15000
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)

        $requestLine = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($requestLine)) {
            $client.Close()
            continue
        }

        $contentLength = 0
        while ($true) {
            $headerLine = $reader.ReadLine()
            if ([string]::IsNullOrEmpty($headerLine)) { break }
            if ($headerLine -match "^Content-Length:\s*(\d+)") {
                $contentLength = [int]$matches[1]
            }
        }

        $bodyText = ""
        if ($contentLength -gt 0) {
            $buffer = New-Object char[] $contentLength
            $readTotal = 0
            while ($readTotal -lt $contentLength) {
                $r = $reader.Read($buffer, $readTotal, $contentLength - $readTotal)
                if ($r -le 0) { break }
                $readTotal += $r
            }
            $bodyText = -join $buffer[0..($readTotal - 1)]
        }

        $payload = @{ action = "health"; params = @{} }
        if (-not [string]::IsNullOrWhiteSpace($bodyText)) {
            $parsed = ConvertFrom-Json $bodyText
            $payload.action = $payload.action
            if ($parsed.action) { $payload.action = $parsed.action }
            $payload.params = if ($parsed.params) { $parsed.params } else { $parsed }
        }

        $resultObj = $null
        try {
            $resultObj = Invoke-Action $payload.action $payload.params
        } catch {
            $resultObj = @{ ok = $false; error = $_.Exception.Message; stack = $_.ScriptStackTrace }
        }

        $jsonResp = ConvertTo-Json $resultObj -Depth 10 -Compress
        $respBytes = [System.Text.Encoding]::UTF8.GetBytes($jsonResp)
        $headerStr = "HTTP/1.1 200 OK`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($respBytes.Length)`r`nConnection: close`r`n`r`n"
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerStr)

        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Write($respBytes, 0, $respBytes.Length)
        $stream.Flush()
    } catch {
        # Ignore transient socket errors
    } finally {
        if ($null -ne $client) {
            try { $client.Close() } catch {}
        }
    }
}
