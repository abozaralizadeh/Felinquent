; Felinquent's additions to Tauri's Windows installer (bundle.windows.nsis.installerHooks).
; Uninstalling also takes away "Start at login" (the Run value the app writes, see login.rs),
; but an update, which runs the uninstaller in update mode, leaves it as it is.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Felinquent"
  ${EndIf}
!macroend
