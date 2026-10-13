; NSIS installer hooks, wired in via bundle.windows.nsis.installerHooks.

; Tauri's "Delete app data" checkbox on the uninstall page only clears the
; bundle-id folders; the app keeps presets and its log in %APPDATA%\WinAutoStart,
; so the checkbox has to cover that folder too. Skipped on updates, where the
; old version is uninstalled silently and the user's presets must survive.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$APPDATA\WinAutoStart"
  ${EndIf}
!macroend
