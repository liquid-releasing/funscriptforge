; FunscriptForge Windows Installer — NSIS script
; Copyright (c) 2026 Liquid Releasing. Licensed under the MIT License.
;
; Build with:
;   makensis /DVERSION=0.0.10 installer\funscriptforge.nsi
;
; Output: installer\FunscriptForge-v${VERSION}-win.exe

!define APPNAME     "FunscriptForge"
!define PUBLISHER   "Liquid Releasing"
!define APPDIR      "$PROGRAMFILES64\${APPNAME}"
!define REGKEY      "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

; VERSION is passed in via /DVERSION=x.y.z
!ifndef VERSION
  !define VERSION "0.0.0"
!endif

Name "${APPNAME} ${VERSION}"
OutFile "..\installer\FunscriptForge-v${VERSION}-win.exe"
InstallDir "${APPDIR}"
InstallDirRegKey HKLM "${REGKEY}" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

; ------------------------------------------------------------------
; Pages
; ------------------------------------------------------------------
Page license
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

LicenseData "..\LICENSE"

; ------------------------------------------------------------------
; Install section
; ------------------------------------------------------------------
Section "Install" SecInstall

  SetOutPath "$INSTDIR"

  ; Copy everything from PyInstaller output
  File /r "..\dist\FunscriptForge\*.*"

  ; Start Menu shortcut
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" \
    "$INSTDIR\${APPNAME}.exe" "" "$INSTDIR\${APPNAME}.exe" 0

  ; Desktop shortcut
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" \
    "$INSTDIR\${APPNAME}.exe" "" "$INSTDIR\${APPNAME}.exe" 0

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Add/Remove Programs entry
  WriteRegStr   HKLM "${REGKEY}" "DisplayName"      "${APPNAME}"
  WriteRegStr   HKLM "${REGKEY}" "DisplayVersion"   "${VERSION}"
  WriteRegStr   HKLM "${REGKEY}" "Publisher"        "${PUBLISHER}"
  WriteRegStr   HKLM "${REGKEY}" "InstallLocation"  "$INSTDIR"
  WriteRegStr   HKLM "${REGKEY}" "UninstallString"  "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKLM "${REGKEY}" "NoModify"         1
  WriteRegDWORD HKLM "${REGKEY}" "NoRepair"         1

SectionEnd

; ------------------------------------------------------------------
; Uninstall section
; ------------------------------------------------------------------
Section "Uninstall"

  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  RMDir  "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${APPNAME}.lnk"
  DeleteRegKey HKLM "${REGKEY}"

SectionEnd
