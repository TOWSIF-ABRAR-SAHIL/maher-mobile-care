; MSS assisted installer hooks.
;
; Install path is chosen on electron-builder's own MUI_PAGE_DIRECTORY page.
; This file adds a second, built-in directory page for the shop data folder,
; enforces the no-C rule and shows the Update / Cancel prompt. Shop data is
; never placed beside the EXE or under drive C:.
;
; Everything here is installer-only: electron-builder also parses this include
; while generating the uninstaller, where these macros/functions are unused and
; would fail its "warnings are errors" NSIS pass.

!ifndef BUILD_UNINSTALLER

!include LogicLib.nsh

Var mssDataRoot
Var mssStoredRoot
Var mssInstalled

!macro mssRejectDriveC
  StrCpy $0 $mssDataRoot 2
  StrCmp $0 "C:" mss_bad_drive
  StrCmp $0 "c:" mss_bad_drive
  Goto mss_drive_ok
mss_bad_drive:
  MessageBox MB_OK|MB_ICONSTOP "MSS data cannot be stored on drive C:. Choose D: or another non-C drive."
  Abort
mss_drive_ok:
!macroend

; Runs from .onInit. This include is parsed before electron-builder's own
; multiUser variables exist, so detection uses this file's own var + registry.
!macro customInit
  StrCpy $mssDataRoot "D:\MSS-Data"
  StrCpy $mssInstalled ""

  ReadRegStr $mssInstalled HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $mssInstalled == ""
    ReadRegStr $mssInstalled HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}

  ReadRegStr $mssStoredRoot HKCU "${INSTALL_REGISTRY_KEY}" MSSDataRoot
  ${If} $mssStoredRoot == ""
    ReadRegStr $mssStoredRoot HKLM "${INSTALL_REGISTRY_KEY}" MSSDataRoot
  ${EndIf}
  ; A registry value can be absent while the pointer file is still present.
  ; Read it before the data page is skipped so an update never orphans the root.
  ${If} $mssStoredRoot == ""
    ${If} $mssInstalled != ""
      ClearErrors
      FileOpen $0 "$mssInstalled\mss-data-root.txt" r
      ${IfNot} ${Errors}
        FileRead $0 $mssStoredRoot
        FileClose $0
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${If} $mssStoredRoot != ""
    StrCpy $0 $mssStoredRoot 2
    StrCmp $0 "C:" mss_legacy_c
    StrCmp $0 "c:" mss_legacy_c
    StrCpy $mssDataRoot $mssStoredRoot
    Goto mss_root_ready
mss_legacy_c:
    ; An old C: pointer is discarded; the data page below chooses a safe root.
    StrCpy $mssDataRoot "D:\MSS-Data"
mss_root_ready:
  ${EndIf}

  ${If} $mssInstalled != ""
    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_TOPMOST "MSS is already installed. Update to ${VERSION}?$\r$\n$\r$\nChoose Cancel to stop. Your shop data will not be changed." IDYES mss_update_yes IDNO mss_update_no
mss_update_no:
      Quit
mss_update_yes:
    ${EndIf}
  ${EndIf}
!macroend

; A built-in directory page supports a pre-function, so an update can skip it
; while a fresh install still offers the real folder browser.
Function mssDataPagePre
  ${If} $mssInstalled != ""
    Abort
  ${EndIf}
FunctionEnd

Function mssDataPageLeave
  ${If} $mssDataRoot == ""
    MessageBox MB_OK|MB_ICONSTOP "Choose an MSS data folder. Drive C: is not allowed."
    Abort
  ${EndIf}

  !insertmacro mssRejectDriveC

  CreateDirectory "$mssDataRoot"
  IfErrors mss_folder_fail 0
  Goto mss_folder_ok
mss_folder_fail:
  MessageBox MB_OK|MB_ICONSTOP "Cannot create the folder $mssDataRoot. Choose another non-C drive."
  Abort
mss_folder_ok:
FunctionEnd

!macro customPageAfterChangeDir
  PageEx directory
    PageCallbacks mssDataPagePre "" mssDataPageLeave
    Caption "MSS data folder"
    DirText "Bills, technicians and backups are stored here. Drive C: is not allowed." "MSS data folder" "Browse..." "Choose a non-C drive for MSS data"
    DirVar $mssDataRoot
    DirVerify leave
  PageExEnd
!macroend

; Runs inside the install section, after files are unpacked.
!macro customInstall
  FileOpen $0 "$INSTDIR\mss-data-root.txt" w
  IfErrors mss_pointer_fail
  FileWrite $0 "$mssDataRoot"
  FileClose $0
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" MSSDataRoot "$mssDataRoot"
  Goto mss_pointer_done
mss_pointer_fail:
  MessageBox MB_OK|MB_ICONSTOP "Could not save the MSS data folder pointer. Installation stopped."
  Abort
mss_pointer_done:
!macroend

!endif
