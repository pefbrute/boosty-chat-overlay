# Windows QA Virtual Machine (`Winda`)

This document describes the architecture, MCP servers, credentials management, snapshot strategy, and operational workflows for running real Windows 11 release verification of **Boosty Chat Overlay** from the Ubuntu host without Wine.

---

## 1. Architecture & Automation Layers

Automation is strictly separated by layer so each tool operates where it is most reliable:

| Layer | Primary Tool | Purpose |
|---|---|---|
| **1. VirtualBox Lifecycle** | `desktop-hypervisor` MCP (`desktop-hypervisor-mcp` v2.1.2) | Start/stop VM, inspect VM hardware/state, manage snapshots, capture host-level VM screenshots |
| **2. Guest Commands & PowerShell** | `desktop-hypervisor` (`guest` tool) / `scripts/local/winda.sh` | Execute PowerShell scripts, query registry/files/processes/ports inside Windows via `VBoxService` |
| **3. Electron & Web UI** | Playwright / CDP | Inspect Electron renderer UI and browser web content |
| **4. Native Windows GUI** | `windows-gui` MCP (`windows-gui-mcp` ↔ `C:\QA\windows-gui-agent.ps1`) | Drive NSIS installer wizards, SmartScreen prompts, OBS Studio docks, browser shell windows, and native dialogs via Windows UI Automation (`System.Windows.Automation`) |
| **5. File & Installer Transport** | VirtualBox Shared Folder (`qa-share`) | Transfer NSIS `.exe` installers and QA artifacts between `/home/fedor/winda-share` and `Y:\` (`\\VBOXSVR\qa-share`) |

### Automation Preference Order

1. Direct API (HTTP / WebSocket / IPC)
2. Guest Control / PowerShell (`VBoxManage guestcontrol` / `desktop-hypervisor` `guest`)
3. Playwright
4. Windows UI Automation MCP (`windows-gui` via `InvokePattern`, `ValuePattern`, `TogglePattern`, `WindowPattern`)
5. OCR (fallback only)
6. Coordinate clicks (last resort only)

> [!IMPORTANT]
> **Operating Rule:** Never use Wine as evidence of Windows behavior when `Winda` is available and `scripts/local/winda.sh health` passes.

---

## 2. VM Specification (`Winda`)

- **Hypervisor:** Oracle VirtualBox `7.1.8r168469`
- **Guest OS:** Windows 11 Pro 64-bit (`10.0.26100`)
- **Guest Additions:** `7.1.8r168469` (`VBoxService` active)
- **Resources:** 4096 MB RAM, 2 vCPUs, 128 MB VRAM (`VBoxSVGA`, 3D Acceleration disabled for deterministic rendering)
- **Network:** NAT (`NIC 1`) with localhost-only port forwarding:
  - `127.0.0.1:17380` (Ubuntu host) $\rightarrow$ `:17380` (Windows guest UI Automation agent)
- **Security Posture:** Windows Defender, SmartScreen, UAC, and Windows Firewall remain **enabled** to reflect real production user environments.

### Installed QA Software Baseline

- **Brave Browser:** `154.1.96.61` (`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`)
- **Google Chrome:** `151.0.7922.174` (`C:\Program Files\Google\Chrome\Application\chrome.exe`)
- **Microsoft Edge:** `154.0.4258.53` (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`)
- **OBS Studio:** `32.2.2` (`C:\Program Files\obs-studio\bin\64bit\obs64.exe`, built-in `obs-websocket.dll` v5 enabled on port `4455`)

---

## 3. MCP Servers Configuration

Configured in `~/.gemini/config/mcp_config.json` (with automatic backup before modification):

### 3.1. `desktop-hypervisor`

- **Binary:** `~/.local/bin/desktop-hypervisor-mcp` (`bryanjbelanger/desktop-hypervisor-mcp` `v2.1.2`, static Go binary)
- **Wrapper:** `~/.local/bin/desktop-hypervisor-mcp-wrapper` (injects `HV_GUEST_USER` and `HV_GUEST_PASSWORD` from untracked local env)
- **Tools:**
  - `provider` (`list`)
  - `vm_info` (`list`, `running`, `show`, `ip`)
  - `vm_lifecycle` (`start`, `stop`, `suspend`, `reset`)
  - `vm_config` (`resources`, `nested_virt`, `attach_iso`, `guestinfo`)
  - `snapshot` (`list`, `take`, `restore`, `delete`)
  - `guest` (`exec`, `script`, `copy_in`, `copy_out`, `screenshot`)
  - `network` (`expose_guest_port`, `ensure_cluster_network`)
  - `execute_command` (raw `VBoxManage` argv)

### 3.2. `windows-gui`

- **Host Bridge:** `~/.local/bin/windows-gui-mcp` (Node.js stdio MCP server)
- **Guest Agent:** `C:\QA\windows-gui-agent.ps1` (runs in interactive desktop Session 1 via Scheduled Task `BoostyQaGuiAgent` at logon with `RunLevel Highest`)
- **Transport:** HTTP JSON over VirtualBox NAT port forward `127.0.0.1:17380` $\rightarrow$ `guest:17380`
- **Tools:**
  - `health` — verify UI Automation readiness, interactive session ID, and screen dimensions
  - `list_windows` — list visible top-level windows on the Windows desktop
  - `get_ui_tree` — inspect the Windows UI Automation element hierarchy (`AutomationElement`)
  - `launch_app` — start a GUI app or NSIS installer inside the visible interactive desktop session
  - `focus_window` — bring a target window to the foreground
  - `click_element` — invoke a control via `InvokePattern` / `TogglePattern` / `SelectionItemPattern`
  - `set_text` — populate input controls via `ValuePattern` or focused `SendKeys`
  - `send_keys` — send keyboard shortcuts to a focused window
  - `close_window` — close a window via `WindowPattern.Close`

---

## 4. Credentials & Secrets

Guest credentials for the local `qa` account are stored **exclusively outside git**:

- `~/.config/boosty-chat-overlay/winda.env` (`chmod 600`)
- `.local/winda.env` (gitignored via `.gitignore`)

Format:
```ini
WINDA_VM=Winda
WINDA_USER=qa
WINDA_PASSWORD=<redacted>
```

Never commit `WINDA_PASSWORD` to the repository, `mcp_config.json`, or test artifacts.

---

## 5. Shared Folder & Installer Transport

- **Share Name:** `qa-share` (permanent machine mapping, automounted)
- **Ubuntu Host Path:** `/home/fedor/winda-share`
- **Windows Guest Path:** `Y:\` and `\\VBOXSVR\qa-share`
- **Canonical Installer Directory:**
  - Host: `/home/fedor/winda-share/releases/`
  - Guest: `Y:\releases\` (`\\VBOXSVR\qa-share\releases\`)

---

## 6. Snapshots

- **`WindowsQA-Clean`**:
  - Baseline clean state with Guest Additions `7.1.8`, local `qa` user, auto-logon + `BoostyQaGuiAgent` scheduled task, permanent `qa-share` shared folder, Brave, Chrome, Edge, and OBS Studio installed.
  - **Boosty Chat Overlay is NOT installed** (`C:\Program Files\Boosty Chat Overlay` and `%APPDATA%\boosty-chat-overlay` are absent, port `17369` is free, no Boosty browser extensions or OBS Browser Sources exist).
- **`WindowsQA-Configured`** *(created during/after full release setup verification)*:
  - State with Boosty Chat Overlay installed, extension loaded, and OBS scene configured.

---

## 7. Local Helper CLI (`scripts/local/winda.sh`)

For CLI workflows, fallback automation, and health checks:

```bash
# Check VM and GUI agent status
./scripts/local/winda.sh status

# Full readiness health check (VM, Guest Additions, whoami, Y:\, Brave, Chrome, OBS, port 17369, GUI MCP)
./scripts/local/winda.sh health

# Start VM and wait for VBoxService + Windows GUI MCP readiness
./scripts/local/winda.sh start

# Graceful Windows shutdown
./scripts/local/winda.sh stop

# Restore WindowsQA-Clean snapshot
./scripts/local/winda.sh restore-clean

# Full QA reset (stop -> restore WindowsQA-Clean -> start -> wait ready -> health)
./scripts/local/winda.sh reset

# Run PowerShell inside Windows
./scripts/local/winda.sh powershell 'Get-Process'

# Copy an NSIS installer into Y:\releases\
./scripts/local/winda.sh copy-installer "artifacts/release-audit/windows/download/Boosty Chat Overlay Setup 0.4.0.exe"

# Capture VM screenshot
./scripts/local/winda.sh screenshot /tmp/winda.png

# Query Windows GUI Automation agent directly
./scripts/local/winda.sh gui list_windows
```

---

## 8. Recovery

If the Windows GUI MCP agent (`127.0.0.1:17380`) does not respond after a guest restart:

1. `./scripts/local/winda.sh powershell "Start-ScheduledTask -TaskName 'BoostyQaGuiAgent'"`
2. Verify with `./scripts/local/winda.sh gui health`.
3. If the VM state is corrupted by a failed installer test, run `./scripts/local/winda.sh reset` to restore `WindowsQA-Clean` and boot fresh.
