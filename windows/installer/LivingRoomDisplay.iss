; Living Room Display per-user Windows Setup (Inno Setup 6.7+).
; Build with windows/installer/Build-Installer.ps1, which supplies the defines.
; Setup only extracts files and runs the control script's InstallPackage
; command; that script owns every filesystem transaction (see docs/install.md).

#ifndef AppVersion
  #error Define AppVersion (use Build-Installer.ps1)
#endif
#ifndef PayloadZip
  #error Define PayloadZip (use Build-Installer.ps1)
#endif
#ifndef PayloadSha256
  #error Define PayloadSha256 (use Build-Installer.ps1)
#endif
#ifndef ControlScript
  #error Define ControlScript (use Build-Installer.ps1)
#endif
#ifndef SetupIconFile
  #error Define SetupIconFile (use Build-Installer.ps1)
#endif
#ifndef WizardSmallImages
  #error Define WizardSmallImages (use Build-Installer.ps1)
#endif
#ifndef WizardImages
  #error Define WizardImages (use Build-Installer.ps1)
#endif
#ifndef UninstallSize
  #define UninstallSize "0"
#endif
#ifndef OutputDir
  #define OutputDir "output"
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "LivingRoomDisplaySetup-" + AppVersion
#endif

#define AppName "Living Room Display"
; Generated once. Never change it: Windows identifies the install by it, and
; windows/LivingRoomDisplay.ps1 uses the same value to find the registration.
#define AppIdGuid "838B4E42-F1FC-44A0-B108-53DE8DF4563C"

[Setup]
; '{{' is a literal brace for Inno, '{#...}' the preprocessor value: {GUID}.
AppId={{{#AppIdGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Living Room Display project
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Setup
DefaultDirName={localappdata}\LivingRoomDisplay
UsePreviousAppDir=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=yes
DisableReadyMemo=yes
DirExistsWarning=no
PrivilegesRequired=lowest
UninstallFilesDir={app}\uninstall
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\app\windows\LivingRoomDisplay.scr
UninstallDisplaySize={#UninstallSize}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
WizardStyle=modern dynamic
WizardSmallImageFile={#WizardSmallImages}
WizardImageFile={#WizardImages}
SetupIconFile={#SetupIconFile}
Compression=lzma2/ultra64
SolidCompression=yes
SetupMutex=LivingRoomDisplaySetup-{#AppIdGuid}
CloseApplications=no
RestartApplications=no
SetupLogging=yes
ShowLanguageDialog=no
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
#ifdef SignToolName
SignTool={#SignToolName}
SignedUninstaller=yes
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WizardReady=Ready to install Living Room Display
ReadyLabel1=
ReadyLabel2a=
ReadyLabel2b=
WizardPreparing=Installing Living Room Display
PreparingDesc=Setup is installing Living Room Display on this PC.
FinishedHeadingLabel=Living Room Display is ready
FinishedLabel=Open it any time from the Start menu.
FinishedLabelNoIcons=Open it any time from the Start menu.
ConfirmUninstall=Remove Living Room Display from this PC?

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Dirs]
; Lets the uninstaller remove an empty install folder after a data-delete uninstall.
Name: "{app}"; Flags: uninsalwaysuninstall

[Files]
Source: "{#ControlScript}"; Flags: dontcopy
Source: "{#PayloadZip}"; Flags: dontcopy
; A version-matched copy the uninstaller runs (Uninstall -FromInstaller).
Source: "{#ControlScript}"; DestDir: "{app}\uninstall"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Living Room Display"; Filename: "{app}\app\windows\LivingRoomDisplay.scr"; Parameters: "--editor"; WorkingDir: "{app}\app\windows"; IconFilename: "{app}\app\windows\LivingRoomDisplay.scr"; Comment: "Open the Living Room Display editor"
Name: "{autoprograms}\Living Room Display - Show display"; Filename: "{app}\app\windows\LivingRoomDisplay.scr"; Parameters: "--display"; WorkingDir: "{app}\app\windows"; IconFilename: "{app}\app\windows\LivingRoomDisplay.scr"; Comment: "Show the ambient display now. Move the mouse or press a key to close it."
Name: "{autodesktop}\Living Room Display"; Filename: "{app}\app\windows\LivingRoomDisplay.scr"; Parameters: "--editor"; WorkingDir: "{app}\app\windows"; IconFilename: "{app}\app\windows\LivingRoomDisplay.scr"; Comment: "Open the Living Room Display editor"; Tasks: desktopicon

[Run]
Filename: "{app}\app\windows\LivingRoomDisplay.scr"; Parameters: "--editor"; Description: "Open Living Room Display"; Flags: postinstall nowait skipifsilent

[Code]
const
  HelperName = 'LivingRoomDisplay.ps1';
  PayloadName = 'payload.zip';
  PayloadSha256 = '{#PayloadSha256}';
  NewVersion = '{#AppVersion}';
  MsgNothingChanged = ' Nothing was changed.';
  // The helper logs these exact lines; LivingRoomDisplay.ps1 carries the same
  // text ($script:...Note) and Test-InstallerPolicy.ps1 checks that they match.
  // It first finished an earlier run's rollback (a previous version went back),
  // or first undid an earlier unfinished install that had no previous version.
  ResumedNote = 'Setup first put back the version from before an earlier unfinished update.';
  ResumedUndoNote = 'Setup first undid an earlier unfinished installation.';
  // The record of an earlier unfinished update could not be read (E20, #204).
  RecordInUseNote = 'The record of an earlier unfinished update is in use by another program';
  // What a failed first install left behind (#206).
  FirstInstallRemovedNote = 'Removed everything the failed first install added.';
  FirstInstallKeptDataNote = 'Removed the program files the failed first install added; the data the app wrote stays.';
  FirstInstallLeftNote = 'The failed first install leaves';
  FirstInstallCleanupFailedNote = 'Could not remove everything the failed first install added';
  // E22 names the folder that holds a file in use (#200).
  HeldFolderPrefix = 'LRD-E22: A file in ';
  HeldFolderSuffix = ' is in use';

var
  DesktopCheck: TNewCheckBox;
  ProgressPage: TOutputMarqueeProgressWizardPage;
  StepFile: String;
  LastStep: String;
  RemoveDataChosen: Boolean;
  // Taken before the helper runs, which changes the folder: they choose the
  // wording of its failure messages.
  HadPreviousApp: Boolean;
  KeptDataOnly: Boolean;
  // Read from the helper log. ResumedText: the note above when this run first
  // finished an earlier run's rollback, so no message claims that nothing was
  // changed. The rest: what the helper did, so the message says exactly that.
  ResumedText: String;
  RecordInUse: Boolean;
  FirstInstallRemovedAll: Boolean;
  FirstInstallKeptData: Boolean;
  FirstInstallLeftFiles: Boolean;
  HeldFolder: String;

function SetTimer(hWnd, nIDEvent, uElapse, lpTimerFunc: Longword): Longword;
  external 'SetTimer@user32.dll stdcall';
function KillTimer(hWnd, nIDEvent: Longword): Bool;
  external 'KillTimer@user32.dll stdcall';

function PowerShellPath: String;
begin
  Result := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
end;

function JsonStringValue(const Json, Key: String): String;
var
  Rest: String;
  P: Integer;
begin
  Result := '';
  P := Pos('"' + Key + '"', Json);
  if P = 0 then Exit;
  Rest := Copy(Json, P + Length(Key) + 2, Length(Json));
  P := Pos(':', Rest);
  if P = 0 then Exit;
  Rest := Copy(Rest, P + 1, Length(Rest));
  P := Pos('"', Rest);
  if P = 0 then Exit;
  Rest := Copy(Rest, P + 1, Length(Rest));
  P := Pos('"', Rest);
  if P = 0 then Exit;
  Result := Copy(Rest, 1, P - 1);
end;

function ReadVersionFrom(const FileName: String): String;
var
  Json: AnsiString;
begin
  Result := '';
  if LoadStringFromFile(FileName, Json) then
    Result := JsonStringValue(String(Json), 'version');
end;

function InstallDir: String;
begin
  Result := WizardDirValue;
end;

function IsUpgrade: Boolean;
begin
  Result := FileExists(AddBackslash(InstallDir) + 'installation.json');
end;

function MarkerValue(const Key: String): String;
var
  Json: AnsiString;
begin
  Result := '';
  if LoadStringFromFile(AddBackslash(InstallDir) + 'installation.json', Json) then
    Result := JsonStringValue(String(Json), Key);
end;

function MarkerState: String;
begin
  Result := MarkerValue('state');
end;

// A Setup install updated from source since keeps the newest Setup version as
// its downgrade guard (#159).
function SourceUpdatedFromSetup: Boolean;
begin
  Result := (MarkerValue('lastPackageVersion') <> '') and (MarkerValue('channel') <> 'package');
end;

// An earlier uninstall chose "Keep my data": the marker remains, the app doesn't.
function IsKeptDataReinstall: Boolean;
begin
  Result := IsUpgrade and (MarkerState = 'uninstalled');
end;

function InstalledVersion: String;
begin
  Result := ReadVersionFrom(AddBackslash(InstallDir) + 'app\release.json');
  if Result = '' then
    Result := ReadVersionFrom(AddBackslash(InstallDir) + 'app\package.json');
  if Result = '' then
    Result := ReadVersionFrom(AddBackslash(InstallDir) + 'installation.json');
end;

function UacEnabled: Boolean;
var
  Value: Cardinal;
begin
  Result := True;
  if RegQueryDWordValue(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System', 'EnableLUA', Value) then
    Result := Value <> 0;
end;

function EdgeInstalled: Boolean;
begin
  Result := FileExists(ExpandConstant('{commonpf32}\Microsoft\Edge\Application\msedge.exe')) or
    FileExists(ExpandConstant('{commonpf64}\Microsoft\Edge\Application\msedge.exe')) or
    FileExists(ExpandConstant('{localappdata}\Microsoft\Edge\Application\msedge.exe'));
end;

function NetFramework4Installed: Boolean;
var
  Release: Cardinal;
begin
  Result := RegQueryDWordValue(HKLM, 'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', Release) and (Release >= 378389);
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  // An elevated Setup would start the server elevated. /ALLOWELEVATED=1 exists only
  // for build agents, such as GitHub's runners, that always run elevated.
  if IsAdmin and UacEnabled and (ExpandConstant('{param:ALLOWELEVATED|0}') = '1') then
    Log('Elevated launch allowed by /ALLOWELEVATED=1 (automation only).')
  else if IsAdmin and UacEnabled then
  begin
    Log('Refusing an elevated launch while User Account Control is on.');
    SuppressibleMsgBox('Please run Setup normally, without ''Run as administrator''.', mbError, MB_OK, IDOK);
    Result := False;
    Exit;
  end;
  if not EdgeInstalled then
  begin
    Log('Warning: Microsoft Edge was not found.');
    SuppressibleMsgBox('Microsoft Edge wasn''t found. You can still use the editor in any browser, but the full-screen display needs Microsoft Edge.', mbInformation, MB_OK, IDOK);
  end;
  if not NetFramework4Installed then
  begin
    Log('Warning: .NET Framework 4.5 or later was not found.');
    SuppressibleMsgBox('The .NET Framework 4 wasn''t found. Setup can continue, but the Start menu shortcuts and the full-screen display need it. Turn on .NET Framework 4.8 in Windows Features, then open Living Room Display again.', mbInformation, MB_OK, IDOK);
  end;
end;

procedure InitializeWizard;
begin
  DesktopCheck := TNewCheckBox.Create(WizardForm);
  DesktopCheck.Parent := WizardForm.ReadyPage;
  DesktopCheck.Caption := 'Create a desktop shortcut';
  DesktopCheck.Checked := False;
  DesktopCheck.Left := 0;
  DesktopCheck.Width := WizardForm.ReadyPage.Width;
  DesktopCheck.Height := ScaleY(20);
  ProgressPage := CreateOutputMarqueeProgressPage('Installing Living Room Display', 'Setup is installing Living Room Display on this PC.');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  // The Ready page is the only page: its checkbox replaces the tasks page.
  Result := PageID = wpSelectTasks;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpReady then
  begin
    WizardForm.ReadyLabel.WordWrap := True;
    if IsKeptDataReinstall then
    begin
      WizardForm.PageNameLabel.Caption := 'Ready to install Living Room Display';
      WizardForm.ReadyLabel.Caption := 'Install Living Room Display version ' + NewVersion + '. Setup found the settings, reminders and photo you kept when you removed it, and will use them again after saving a backup copy. It won''t change your screen saver or start automatically with Windows.';
    end else if IsUpgrade and (MarkerState = 'installing') then
    begin
      // An earlier first install failed or was interrupted (#179).
      WizardForm.PageNameLabel.Caption := 'Ready to install Living Room Display';
      WizardForm.ReadyLabel.Caption := 'An earlier installation of Living Room Display didn''t finish. Setup will clean up what it left and install version ' + NewVersion + ' just for you (no administrator rights). It won''t change your screen saver or start automatically with Windows.';
    end else if IsUpgrade then
    begin
      WizardForm.PageNameLabel.Caption := 'Ready to update Living Room Display';
      WizardForm.ReadyLabel.Caption := 'Update Living Room Display to version ' + NewVersion + '. Your settings, reminders and photo stay where they are, and Setup saves a backup copy first. If the editor is open with unsaved changes, save them before continuing. The display will close during the update.';
    end else
    begin
      WizardForm.PageNameLabel.Caption := 'Ready to install Living Room Display';
      WizardForm.ReadyLabel.Caption := 'Living Room Display turns this PC''s screen into a calm, dark clock-and-weather display. Setup installs it just for you (no administrator rights), adds it to the Start menu and keeps everything on this PC: no account, no cloud. It won''t change your screen saver or start automatically with Windows.';
    end;
    WizardForm.PageDescriptionLabel.Caption := '';
    WizardForm.AdjustLabelHeight(WizardForm.ReadyLabel);
    DesktopCheck.Top := WizardForm.ReadyLabel.Top + WizardForm.ReadyLabel.Height + ScaleY(16);
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  // Interactive choice only; a silent install keeps any /TASKS= request.
  if (CurPageID = wpReady) and not WizardSilent then
  begin
    if DesktopCheck.Checked then
      WizardSelectTasks('desktopicon')
    else
      WizardSelectTasks('!desktopicon');
  end;
end;

procedure StepTimerProc(Arg1, Arg2, Arg3, Arg4: Longword);
var
  Raw: AnsiString;
  Step: String;
begin
  if not LoadStringFromFile(StepFile, Raw) then Exit;
  Step := Trim(String(Raw));
  if Step = LastStep then Exit;
  LastStep := Step;
  // Assign captions directly: no nested message processing inside the timer.
  if Step = 'verify' then ProgressPage.Msg2Label.Caption := 'Checking the download...'
  else if Step = 'backup' then ProgressPage.Msg2Label.Caption := 'Saving a backup of your settings...'
  else if Step = 'install' then ProgressPage.Msg2Label.Caption := 'Installing...'
  else if Step = 'start' then ProgressPage.Msg2Label.Caption := 'Starting Living Room Display...';
end;

procedure ReadHelperLine(const Line: String);
var
  P: Integer;
  Rest: String;
begin
  if Pos(ResumedNote, Line) > 0 then
    ResumedText := ResumedNote
  else if (Pos(ResumedUndoNote, Line) > 0) and (ResumedText = '') then
    ResumedText := ResumedUndoNote;
  if Pos(RecordInUseNote, Line) > 0 then
    RecordInUse := True;
  if Pos(FirstInstallRemovedNote, Line) > 0 then
    FirstInstallRemovedAll := True;
  if Pos(FirstInstallKeptDataNote, Line) > 0 then
    FirstInstallKeptData := True;
  if (Pos(FirstInstallLeftNote, Line) > 0) or (Pos(FirstInstallCleanupFailedNote, Line) > 0) then
    FirstInstallLeftFiles := True;
  P := Pos(HeldFolderPrefix, Line);
  if P > 0 then
  begin
    Rest := Copy(Line, P + Length(HeldFolderPrefix), Length(Line));
    P := Pos(HeldFolderSuffix, Rest);
    if P > 1 then
      HeldFolder := Copy(Rest, 1, P - 1);
  end;
end;

procedure AppendHelperLog(const FileName: String);
var
  Lines: TArrayOfString;
  I: Integer;
begin
  if not LoadStringsFromFile(FileName, Lines) then
  begin
    Log('The helper log was not written: ' + FileName);
    Exit;
  end;
  Log('--- Living Room Display helper log ---');
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    Log(Lines[I]);
    ReadHelperLine(Lines[I]);
  end;
  Log('--- end of helper log ---');
end;

function LogHint: String;
begin
  Result := ' Details are in the setup log';
  if ExpandConstant('{log}') <> '' then
    Result := Result + ': ' + ExpandConstant('{log}');
  Result := Result + '.';
end;

function NothingChanged: String;
begin
  if ResumedText <> '' then
    Result := ' ' + ResumedText + ' Nothing else was changed.'
  else
    Result := MsgNothingChanged;
end;

// E15, E16 and E20 start with the same note as a refusal when this run first
// finished an earlier run's rollback (#206).
function ResumedFirst: String;
begin
  if ResumedText <> '' then
    Result := ResumedText + ' '
  else
    Result := '';
end;

function DeleteFolderHint: String;
begin
  Result := ' If you don''t want to, you can delete the folder ' + ExpandConstant('{app}') + '.';
end;

function HelperFailureMessage(Code: Integer; LogWritten: Boolean): String;
begin
  case Code of
    10: Result := 'Setup can''t use the folder ' + ExpandConstant('{app}') + ' because it contains other files.' + NothingChanged;
    11: Result := 'Another program is already using the connection Living Room Display needs (local port 4318). Close any other copy of Living Room Display, then run Setup again.' + NothingChanged;
    12: if KeptDataOnly and SourceUpdatedFromSetup then
          Result := 'The settings kept in this folder are from a newer version of Living Room Display (' + MarkerValue('lastPackageVersion') + ' or later). Install that version or a newer one to use them.' + NothingChanged
        else if KeptDataOnly then
          Result := 'The settings kept in this folder are from a newer version of Living Room Display (' + InstalledVersion + '). Install that version or a newer one to use them.' + NothingChanged
        else if SourceUpdatedFromSetup then
          Result := 'Living Room Display in this folder was installed by a newer Setup (' + MarkerValue('lastPackageVersion') + ') and updated from source since. Use Setup ' + MarkerValue('lastPackageVersion') + ' or newer.' + NothingChanged
        else
          Result := 'A newer version of Living Room Display (' + InstalledVersion + ') is already installed.' + NothingChanged;
    13: Result := 'The setup files look damaged or incomplete. Download Setup again.' + NothingChanged;
    14: Result := 'Living Room Display is busy with another update or uninstall. Wait a moment and try again.';
    15: Result := ResumedFirst + 'The new version didn''t start, so Setup put the previous version back. Your data was not changed.' + LogHint;
    16: if HadPreviousApp then
          Result := ResumedFirst + 'The new version didn''t start, so Setup put the previous version back. Neither version could start; your data was not changed.' + LogHint
        else if KeptDataOnly then
          Result := ResumedFirst + 'Living Room Display didn''t start on this PC, so Setup couldn''t finish installing it. The settings, reminders and photo you kept were not changed. Run Setup again to try again.' + LogHint
        // A failed first install removes what it added (#179). Say what the
        // helper logged that it did, not what the folder looks like (#206).
        else if FirstInstallRemovedAll then
          Result := ResumedFirst + 'Living Room Display didn''t start on this PC, so Setup couldn''t finish installing it and removed everything it had added. Run Setup again to try again.' + LogHint
        else if FirstInstallKeptData then
          Result := ResumedFirst + 'Living Room Display didn''t start on this PC, so Setup couldn''t finish installing it and removed the program files it had added. Run Setup again to try again.' + DeleteFolderHint + LogHint
        else if FirstInstallLeftFiles then
          Result := ResumedFirst + 'Living Room Display didn''t start on this PC, so Setup couldn''t finish installing it, and it couldn''t remove everything it had added yet. Run Setup again: it cleans up first, then tries again.' + DeleteFolderHint + LogHint
        else
          Result := ResumedFirst + 'Living Room Display didn''t start on this PC, so Setup couldn''t finish installing it. Your data was not changed. Run Setup again to try again.' + LogHint;
    17: Result := 'There isn''t enough free disk space (about 500 MB needed).' + NothingChanged;
    18: Result := 'An unexpected runtime is in the app folder; Setup left it untouched.' + NothingChanged;
    19: if ResumedText <> '' then
          Result := 'Setup couldn''t make a safe backup of your data, so it stopped.' + NothingChanged
        else
          Result := 'Setup couldn''t make a safe backup of your data, so nothing was changed.';
    20: if RecordInUse then
          Result := 'Setup couldn''t read its record of an earlier unfinished update (package-transaction.json) because another program is using it, so it didn''t move anything. Your previous version and data are kept. Close that program or restart the PC, then run Setup again.' + LogHint
        else if HadPreviousApp then
          Result := ResumedFirst + 'Setup couldn''t finish, and couldn''t put the previous version back by itself. Your previous version and data are kept. Run Setup again: it puts the previous version back first, then tries the update again.' + LogHint
        else
          Result := ResumedFirst + 'Setup couldn''t finish, and couldn''t undo all of its changes by itself. Your data was not changed. Run Setup again: it finishes undoing them first, then tries again.' + LogHint;
    21: Result := 'The install folder ' + ExpandConstant('{app}') + ' is too long a path for Living Room Display''s files. Install it in a shorter folder.' + NothingChanged;
    22: Result := 'A file in ' + HeldFolder + ', which an earlier update left, is in use, so Setup couldn''t remove that folder before updating. Close the program that''s using it, or restart the PC, then run Setup again.' + NothingChanged;
  else
    if not LogWritten then
      Result := 'Windows settings on this PC don''t allow Setup''s helper script to run (common on work or school PCs). Ask the PC''s administrator, or install on a personal PC.'
    else
      Result := 'Setup couldn''t finish. Your previous version and data were not changed.' + LogHint;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Helper, Payload, HelperLog, Params: String;
  ResultCode: Integer;
  Started: Boolean;
  TimerId: Longword;
begin
  Result := '';
  ProgressPage.SetText('Installing Living Room Display', 'Checking the download...');
  ProgressPage.Show;
  try
    try
      ExtractTemporaryFile(HelperName);
      ExtractTemporaryFile(PayloadName);
    except
      Log('Extracting the setup files failed: ' + GetExceptionMessage);
      Result := HelperFailureMessage(13, True);
      Exit;
    end;
    Helper := ExpandConstant('{tmp}\') + HelperName;
    Payload := ExpandConstant('{tmp}\') + PayloadName;
    HelperLog := ExpandConstant('{tmp}\setup-helper.log');
    StepFile := HelperLog + '.step';
    LastStep := '';
    ResumedText := '';
    RecordInUse := False;
    FirstInstallRemovedAll := False;
    FirstInstallKeptData := False;
    FirstInstallLeftFiles := False;
    HeldFolder := ExpandConstant('{app}\app.previous');
    // An app left by an interrupted first install (marker state installing) is
    // that install's own candidate, which the helper discards: not a previous
    // version (#206).
    HadPreviousApp := (DirExists(ExpandConstant('{app}\app')) or DirExists(ExpandConstant('{app}\app.previous'))) and (MarkerState <> 'installing');
    KeptDataOnly := IsKeptDataReinstall;
    Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + Helper + '" InstallPackage -InstallRoot "' + ExpandConstant('{app}') + '" -PackageArchive "' + Payload + '" -PackageSha256 ' + PayloadSha256 + ' -LogPath "' + HelperLog + '"';
    if ExpandConstant('{param:ALLOWDOWNGRADE|0}') = '1' then
      Params := Params + ' -AllowDowngrade';
    Log('Running: ' + PowerShellPath + ' ' + Params);
    // Plain Exec (never a captured-output variant): the server started by the
    // helper outlives it and must not hold any pipe Setup waits on. Exec keeps
    // pumping messages, so the marquee animates and the step timer fires.
    TimerId := SetTimer(0, 0, 250, CreateCallback(@StepTimerProc));
    try
      Started := Exec(PowerShellPath, Params, ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
    finally
      KillTimer(0, TimerId);
    end;
    AppendHelperLog(HelperLog);
    if not Started then
    begin
      Log('PowerShell could not be started: ' + SysErrorMessage(ResultCode));
      Result := HelperFailureMessage(1, False);
    end else
    begin
      Log('Helper exit code: ' + IntToStr(ResultCode));
      if ResultCode <> 0 then
        Result := HelperFailureMessage(ResultCode, FileExists(HelperLog));
    end;
  finally
    ProgressPage.Hide;
  end;
end;

function OnlyMarkerRemains(const Dir: String): Boolean;
var
  FindRec: TFindRec;
  Name: String;
begin
  Result := True;
  if FindFirst(AddBackslash(Dir) + '*', FindRec) then
  begin
    try
      repeat
        Name := FindRec.Name;
        if (Name <> '.') and (Name <> '..') and (CompareText(Name, 'installation.json') <> 0) and (CompareText(Name, 'uninstall') <> 0) then
          Result := False;
      until (not Result) or (not FindNext(FindRec));
    finally
      FindClose(FindRec);
    end;
  end;
end;

procedure RunUninstallHelper;
var
  AppDir, Helper, HelperLog, Params, Reason: String;
  Lines: TArrayOfString;
  ResultCode, I: Integer;
begin
  AppDir := ExpandConstant('{app}');
  Helper := AppDir + '\uninstall\' + HelperName;
  HelperLog := ExpandConstant('{tmp}\uninstall-helper.log');
  Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + Helper + '" Uninstall -FromInstaller -InstallRoot "' + AppDir + '" -LogPath "' + HelperLog + '"';
  if RemoveDataChosen then
    Params := Params + ' -RemoveData';
  Log('Running: ' + PowerShellPath + ' ' + Params);
  if Exec(PowerShellPath, Params, ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0) then
    Exit;
  Reason := 'exit code ' + IntToStr(ResultCode);
  if LoadStringsFromFile(HelperLog, Lines) then
    for I := 0 to GetArrayLength(Lines) - 1 do
    begin
      Log(Lines[I]);
      if Pos('Failed: ', Lines[I]) > 0 then
        Reason := Copy(Lines[I], Pos('Failed: ', Lines[I]) + 8, Length(Lines[I]));
    end;
  Reason := Trim(Reason);
  if (Length(Reason) > 0) and (Reason[Length(Reason)] = '.') then
    Delete(Reason, Length(Reason), 1);
  // Raising here aborts the uninstall before anything else is removed, so the
  // Apps & Features entry stays and Setup can repair the install. The helper
  // renames every folder aside before it deletes any (#207), so a file in use
  // leaves the app in place.
  RaiseException('Living Room Display couldn''t stop or remove some files: ' + Reason + '. Your data was not deleted. Close any program that is using these files (or restart the PC), then uninstall again. If Living Room Display doesn''t open, run Setup again to repair it first.');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  AppDir: String;
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    RemoveDataChosen := ExpandConstant('{param:REMOVEDATA|0}') = '1';
    if (not RemoveDataChosen) and (not UninstallSilent) then
      RemoveDataChosen := TaskDialogMsgBox('Keep your settings, reminders and photo?',
        'Keeping them lets you pick up where you left off if you reinstall.',
        mbConfirmation, MB_YESNO, ['Keep my data', 'Delete my data'], 0) = IDNO;
    Log('Remove data: ' + IntToStr(Ord(RemoveDataChosen)));
    RunUninstallHelper;
  end else if (CurUninstallStep = usDone) and RemoveDataChosen then
  begin
    AppDir := ExpandConstant('{app}');
    if DirExists(AppDir) and OnlyMarkerRemains(AppDir) then
    begin
      DeleteFile(AddBackslash(AppDir) + 'installation.json');
      // The uninstaller's own folder disappears only after this process ends;
      // a short-lived cmd removes the then-empty folders (rd never recurses).
      Exec(ExpandConstant('{cmd}'), '/d /s /c "for /l %i in (1,1,30) do @(ping -n 2 127.0.0.1 >nul & rd "' + AppDir + '\uninstall" 2>nul & rd "' + AppDir + '" 2>nul & if not exist "' + AppDir + '\" exit /b 0)"', ExpandConstant('{sys}'), SW_HIDE, ewNoWait, ResultCode);
    end;
  end;
end;
