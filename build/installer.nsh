; Custom NSIS Installer & Uninstaller script for Boosty Chat Overlay
; Ensures clean uninstallation and prevents stale AppData from skipping onboarding on fresh installs.

!macro customInit
  ; If the application is NOT currently installed (fresh install from scratch or after uninstall),
  ; clean up any stale leftover AppData from previous uninstalled versions so onboarding starts from a clean slate.
  ReadRegStr $R9 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${if} $R9 == ""
    RMDir /r "$APPDATA\boosty-chat-overlay"
    RMDir /r "$APPDATA\Boosty Chat Overlay"
    RMDir /r "$LOCALAPPDATA\boosty-chat-overlay"
  ${endif}
!macroend

!macro customUnInstall
  ; When the user uninstalls the application, remove all AppData and installation registry keys.
  ; If it is an in-place upgrade (--updated flag passed by installer), AppData is preserved.
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\boosty-chat-overlay"
    RMDir /r "$APPDATA\Boosty Chat Overlay"
    RMDir /r "$LOCALAPPDATA\boosty-chat-overlay"
    DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  ${endif}
!macroend
