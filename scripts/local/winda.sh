#!/usr/bin/env bash
set -euo pipefail

# Winda VirtualBox QA Helper for Boosty Chat Overlay
# Thin CLI wrapper around VirtualBox Guest Control, desktop-hypervisor-mcp, and windows-gui-mcp.
# Credentials are loaded strictly from local untracked env files.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -f "$HOME/.config/boosty-chat-overlay/winda.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$HOME/.config/boosty-chat-overlay/winda.env"
  set +a
elif [ -f "$PROJECT_ROOT/.local/winda.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROJECT_ROOT/.local/winda.env"
  set +a
fi

WINDA_VM="${WINDA_VM:-Winda}"
WINDA_USER="${WINDA_USER:-qa}"
WINDA_PASSWORD="${WINDA_PASSWORD:-}"
WINDA_SHARE_HOST="${WINDA_SHARE_HOST:-$HOME/winda-share}"
WINDA_CLEAN_SNAPSHOT="${WINDA_CLEAN_SNAPSHOT:-WindowsQA-Clean}"
WINDA_GUI_PORT="${WINDA_GUI_PORT:-17380}"
LOG_DIR="$PROJECT_ROOT/artifacts/release-audit/windows/runtime"
mkdir -p "$LOG_DIR" "$WINDA_SHARE_HOST/releases"
TRANSCRIPT_LOG="$LOG_DIR/winda-transcript.log"

log_op() {
  local op="$1"
  local rc="$2"
  local dur="$3"
  printf '%s\top=%s\texit=%s\tduration_s=%s\n' "$(date -Is)" "$op" "$rc" "$dur" >> "$TRANSCRIPT_LOG"
}

require_creds() {
  if [ -z "$WINDA_PASSWORD" ]; then
    echo "ERROR: WINDA_PASSWORD is not set. Configure ~/.config/boosty-chat-overlay/winda.env" >&2
    exit 1
  fi
}

vm_state() {
  VBoxManage showvminfo "$WINDA_VM" --machinereadable 2>/dev/null | awk -F'=' '/^VMState=/ { gsub(/"/, "", $2); print $2 }'
}

guest_exec_raw() {
  require_creds
  local timeout_s="${1:-60}"
  shift
  local exe="$1"
  shift
  timeout "${timeout_s}s" VBoxManage guestcontrol "$WINDA_VM" run \
    --username "$WINDA_USER" \
    --password "$WINDA_PASSWORD" \
    --exe "$exe" \
    --wait-stdout \
    --wait-stderr \
    -- "$@"
}

guest_ps() {
  local cmd="$1"
  local timeout_s="${2:-60}"
  local utf8_cmd="\$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $cmd"
  guest_exec_raw "$timeout_s" "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" \
    -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$utf8_cmd" | tr -d '\r'
}

wait_guest_ready() {
  local timeout_s="${1:-90}"
  local start_ts
  start_ts="$(date +%s)"
  echo "Waiting up to ${timeout_s}s for $WINDA_VM VBoxService & Guest Control..."
  while true; do
    local now_ts elapsed
    now_ts="$(date +%s)"
    elapsed=$((now_ts - start_ts))
    if [ "$elapsed" -ge "$timeout_s" ]; then
      echo "ERROR: Timeout (${timeout_s}s) waiting for guest readiness" >&2
      return 1
    fi

    local state
    state="$(vm_state || true)"
    if [ "$state" != "running" ]; then
      sleep 2
      continue
    fi

    local ga_ver
    ga_ver="$(VBoxManage guestproperty get "$WINDA_VM" "/VirtualBox/GuestAdd/Version" 2>/dev/null | awk '/^Value:/ {print $2}' || true)"
    if [ -n "$ga_ver" ]; then
      local who
      who="$(guest_ps "whoami" 10 2>/dev/null || true)"
      if [[ "$who" == *"\\$WINDA_USER"* ]]; then
        # Ensure GUI agent is responding
        local gui_healthy=false
        for _ in $(seq 1 15); do
          if curl -sf -m 2 -X POST "http://127.0.0.1:${WINDA_GUI_PORT}/" -d '{"action":"health"}' >/dev/null 2>&1; then
            gui_healthy=true
            break
          fi
          sleep 1
        done

        # If updated agent script is available on host, sync and reload agent in Session 1
        if [ -f "$PROJECT_ROOT/scripts/local/windows-gui-agent.ps1" ] && [ "$gui_healthy" = true ]; then
          cp "$PROJECT_ROOT/scripts/local/windows-gui-agent.ps1" "$WINDA_SHARE_HOST/windows-gui-agent.ps1"
          local health_json
          health_json="$(curl -sf -m 3 -X POST "http://127.0.0.1:${WINDA_GUI_PORT}/" -d '{"action":"health"}' 2>/dev/null || echo '{}')"
          local cur_pid
          cur_pid="$(echo "$health_json" | grep -o '"pid":[0-9]*' | head -n1 | cut -d: -f2)"

          # Check if in-guest script needs updating
          local need_update
          need_update="$(guest_ps 'if ((Get-Item "C:\QA\windows-gui-agent.ps1" -ErrorAction SilentlyContinue).Length -ne (Get-Item "\\VBOXSVR\qa-share\windows-gui-agent.ps1").Length) { "yes" } else { "no" }' 10 2>/dev/null || echo "no")"
          if [ "$need_update" = "yes" ]; then
            echo "Updating in-guest windows-gui-agent.ps1 (cur_pid=$cur_pid)..."
            guest_ps 'Copy-Item "\\VBOXSVR\qa-share\windows-gui-agent.ps1" "C:\QA\windows-gui-agent.ps1" -Force' 10 >/dev/null 2>&1 || true
            if [ -n "$cur_pid" ] && [ "$cur_pid" -gt 0 ]; then
              curl -sf -m 5 -X POST "http://127.0.0.1:${WINDA_GUI_PORT}/" -d "{
                \"action\": \"launch_app\",
                \"params\": {
                  \"path\": \"powershell.exe\",
                  \"args\": [\"-NoProfile\", \"-WindowStyle\", \"Hidden\", \"-Command\", \"Start-Sleep -Milliseconds 600; Stop-Process -Id $cur_pid -Force; Start-Process powershell.exe -ArgumentList '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\\QA\\windows-gui-agent.ps1'\"]
                }
              }" >/dev/null 2>&1 || true
              sleep 2
              # Wait for restarted agent
              for _ in $(seq 1 10); do
                if curl -sf -m 2 -X POST "http://127.0.0.1:${WINDA_GUI_PORT}/" -d '{"action":"health"}' >/dev/null 2>&1; then
                  echo "Updated GUI agent restarted in Session 1"
                  break
                fi
                sleep 1
              done
            fi
          fi
        fi

        echo "Guest ready in ${elapsed}s (user: $who, GuestAdd: $ga_ver)"
        return 0
      fi
    fi
    sleep 2
  done
}

cmd_status() {
  local t0
  t0="$(date +%s)"
  local state
  state="$(vm_state || echo "unknown")"
  local ga_ver
  ga_ver="$(VBoxManage guestproperty get "$WINDA_VM" "/VirtualBox/GuestAdd/Version" 2>/dev/null | awk '/^Value:/ {print $2}' || echo "none")"
  local gui_ok="offline"
  if [ "$state" = "running" ] && curl -sf -m 2 -X POST "http://127.0.0.1:${WINDA_GUI_PORT}/" -d '{"action":"health"}' >/dev/null 2>&1; then
    gui_ok="ready"
  fi
  echo "VM: $WINDA_VM"
  echo "State: $state"
  echo "Guest Additions: ${ga_ver:-unknown}"
  echo "Windows GUI MCP Agent (127.0.0.1:${WINDA_GUI_PORT}): $gui_ok"
  log_op "status" 0 "$(( $(date +%s) - t0 ))"
}

cmd_start() {
  local t0
  t0="$(date +%s)"
  local state
  state="$(vm_state)"
  if [ "$state" = "running" ]; then
    echo "VM '$WINDA_VM' is already running."
  else
    local ui_type="headless"
    if [ -n "${DISPLAY:-}" ]; then
      ui_type="${WINDA_UI_TYPE:-gui}"
    fi
    echo "Starting VM '$WINDA_VM' ($ui_type)..."
    timeout 60s VBoxManage startvm "$WINDA_VM" --type "$ui_type"
  fi
  wait_guest_ready 90
  log_op "start" 0 "$(( $(date +%s) - t0 ))"
}

cmd_stop() {
  local t0
  t0="$(date +%s)"
  local state
  state="$(vm_state)"
  if [ "$state" = "poweroff" ] || [ "$state" = "aborted" ]; then
    echo "VM '$WINDA_VM' is already powered off ($state)."
    log_op "stop" 0 0
    return 0
  fi
  if [ "$state" = "saved" ]; then
    echo "Discarding saved state for '$WINDA_VM'..."
    VBoxManage discardstate "$WINDA_VM"
    log_op "stop" 0 "$(( $(date +%s) - t0 ))"
    return 0
  fi

  echo "Initiating graceful shutdown of '$WINDA_VM'..."
  curl -sf -m 5 -X POST "http://127.0.0.1:${WINDA_GUI_PORT}/" \
    -H "Content-Type: application/json" \
    -d '{"action":"launch_app","params":{"path":"C:\\Windows\\System32\\shutdown.exe","args":["/s","/t","0","/f"],"wait_window_sec":1}}' >/dev/null 2>&1 \
    || guest_ps "shutdown.exe /s /t 0 /f" 10 >/dev/null 2>&1 \
    || VBoxManage controlvm "$WINDA_VM" acpipowerbutton >/dev/null 2>&1 || true

  local waited=0
  while [ "$waited" -lt 60 ]; do
    state="$(vm_state)"
    if [ "$state" = "poweroff" ]; then
      echo "VM '$WINDA_VM' powered off cleanly in ${waited}s."
      log_op "stop" 0 "$(( $(date +%s) - t0 ))"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done

  echo "WARN: Graceful shutdown timed out after 60s; forcing poweroff..." >&2
  VBoxManage controlvm "$WINDA_VM" poweroff
  sleep 2
  log_op "stop" 0 "$(( $(date +%s) - t0 ))"
}

cmd_restore_clean() {
  local t0
  t0="$(date +%s)"
  local snap="${1:-$WINDA_CLEAN_SNAPSHOT}"
  local state
  state="$(vm_state)"
  if [ "$state" = "running" ] || [ "$state" = "paused" ]; then
    cmd_stop
  fi
  echo "Restoring snapshot '$snap' on '$WINDA_VM'..."
  timeout 60s VBoxManage snapshot "$WINDA_VM" restore "$snap"
  log_op "restore-clean:$snap" 0 "$(( $(date +%s) - t0 ))"
}

cmd_health() {
  local t0
  t0="$(date +%s)"
  local state
  state="$(vm_state || echo "missing")"
  if [ "$state" != "running" ]; then
    echo "FAIL: VM '$WINDA_VM' is not running (state=$state)" >&2
    log_op "health" 1 "$(( $(date +%s) - t0 ))"
    return 1
  fi

  local ga_ver
  ga_ver="$(VBoxManage guestproperty get "$WINDA_VM" "/VirtualBox/GuestAdd/Version" 2>/dev/null | awk '/^Value:/ {print $2}' || true)"
  if [ -z "$ga_ver" ]; then
    echo "FAIL: Guest Additions version not reported" >&2
    log_op "health" 1 "$(( $(date +%s) - t0 ))"
    return 1
  fi

  local ps_json
  ps_json="$(guest_ps '
    if (-not (Test-Path "Y:\")) { net use Y: "\\VBOXSVR\qa-share" /persistent:yes 2>&1 | Out-Null }
    $port17369 = Get-NetTCPConnection -LocalPort 17369 -ErrorAction SilentlyContinue
    @{
      Whoami = (whoami)
      SharedFolder = (Test-Path "Y:\") -or (Test-Path "\\VBOXSVR\qa-share")
      Brave = (Test-Path "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe")
      Chrome = (Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe")
      OBS = (Test-Path "C:\Program Files\obs-studio\bin\64bit\obs64.exe")
      Port17369Free = ($null -eq $port17369)
      BoostyInstalled = (Test-Path "C:\Program Files\Boosty Chat Overlay\Boosty Chat Overlay.exe") -or (Test-Path "$env:LOCALAPPDATA\Programs\Boosty Chat Overlay\Boosty Chat Overlay.exe") -or (Test-Path "$env:LOCALAPPDATA\Programs\boosty-chat-overlay\Boosty Chat Overlay.exe")
    } | ConvertTo-Json -Compress
  ' 30)"

  echo "Guest Check: $ps_json"

  local gui_health
  gui_health="$(curl -sf -m 5 -X POST "http://127.0.0.1:${WINDA_GUI_PORT}/" -d '{"action":"health"}' || echo '{"ok":false}')"
  echo "GUI Agent Check: $gui_health"

  node -e '
    const g = JSON.parse(process.argv[1]);
    const u = JSON.parse(process.argv[2]);
    const checks = [
      ["Guest Control (whoami)", Boolean(g.Whoami && g.Whoami.toLowerCase().includes("qa"))],
      ["Shared Folder (Y:\\)", Boolean(g.SharedFolder)],
      ["Brave Installed", Boolean(g.Brave)],
      ["Chrome Installed", Boolean(g.Chrome)],
      ["OBS Installed", Boolean(g.OBS)],
      ["Port 17369 Free", Boolean(g.Port17369Free)],
      ["Windows GUI MCP Ready", Boolean(u.ok && u.uiaAvailable)]
    ];
    let failed = false;
    for (const [name, ok] of checks) {
      console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}`);
      if (!ok) failed = true;
    }
    if (failed) process.exit(1);
  ' "$ps_json" "$gui_health"

  log_op "health" 0 "$(( $(date +%s) - t0 ))"
}

cmd_reset() {
  local t0
  t0="$(date +%s)"
  cmd_restore_clean "$WINDA_CLEAN_SNAPSHOT"
  cmd_start
  cmd_health
  log_op "reset" 0 "$(( $(date +%s) - t0 ))"
}

cmd_copy_installer() {
  local t0
  t0="$(date +%s)"
  local src="${1:-}"
  if [ -z "$src" ] || [ ! -f "$src" ]; then
    echo "ERROR: Installer file not found: $src" >&2
    exit 1
  fi
  local base
  base="$(basename "$src")"
  local dest="$WINDA_SHARE_HOST/releases/$base"
  cp -f "$src" "$dest"
  echo "Copied to host shared folder: $dest"
  if [ "$(vm_state)" = "running" ]; then
    local guest_ver
    guest_ver="$(guest_ps "if (-not (Test-Path 'Y:\')) { net use Y: '\\VBOXSVR\qa-share' | Out-Null }; if (Test-Path \"\\\\VBOXSVR\\qa-share\\releases\\$base\") { (Get-Item \"\\\\VBOXSVR\\qa-share\\releases\\$base\").Length } else { 'MISSING' }" 20)"
    echo "Verified inside Windows (\\\\VBOXSVR\\qa-share\\releases\\$base): $guest_ver bytes"
  fi
  log_op "copy-installer" 0 "$(( $(date +%s) - t0 ))"
}

cmd_screenshot() {
  local t0
  t0="$(date +%s)"
  local out="${1:-/tmp/winda.png}"
  mkdir -p "$(dirname "$out")"
  VBoxManage controlvm "$WINDA_VM" screenshotpng "$out"
  echo "Screenshot saved to $out ($(stat -c%s "$out") bytes)"
  log_op "screenshot" 0 "$(( $(date +%s) - t0 ))"
}

cmd_gui() {
  local t0
  t0="$(date +%s)"
  local action="${1:-health}"
  local params="${2:-{}}"
  curl -sf -m 20 -X POST "http://127.0.0.1:${WINDA_GUI_PORT}/" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"$action\",\"params\":$params}"
  echo ""
  log_op "gui:$action" 0 "$(( $(date +%s) - t0 ))"
}

SUBCOMMAND="${1:-status}"
shift || true

case "$SUBCOMMAND" in
  status)         cmd_status "$@" ;;
  start)          cmd_start "$@" ;;
  stop)           cmd_stop "$@" ;;
  restore-clean)  cmd_restore_clean "$@" ;;
  health)         cmd_health "$@" ;;
  reset)          cmd_reset "$@" ;;
  exec)           guest_exec_raw 60 "$@" ;;
  powershell)     guest_ps "${1:-}" "${2:-60}" ;;
  copy-installer) cmd_copy_installer "$@" ;;
  screenshot)     cmd_screenshot "$@" ;;
  gui)            cmd_gui "$@" ;;
  *)
    echo "Usage: $0 {status|start|stop|restore-clean|health|reset|exec|powershell|copy-installer|screenshot|gui}" >&2
    exit 1
    ;;
esac
