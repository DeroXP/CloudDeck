' Silent launcher for the CloudDeck PC agent. Invoked by the Scheduled Task
' at user logon so the agent inherits the user's interactive session
' (Session 1+) and can spawn GUI apps that actually appear on the desktop.
' Running via wscript with WindowStyle 0 hides the otherwise-visible cmd
' console window.
'
' Argument: path to the agent directory (where index.js lives).

Dim ws : Set ws = CreateObject("Wscript.Shell")

Dim agentDir
If WScript.Arguments.Count > 0 Then
  agentDir = WScript.Arguments(0)
Else
  ' Fallback: assume this script lives at <agent>/scripts/launcher.vbs
  Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")
  agentDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
End If

ws.CurrentDirectory = agentDir
' Window style 0 = hidden. Async (third arg false) so wscript exits as soon
' as node has been spawned — the agent runs detached from this wrapper.
ws.Run "cmd /c node.exe index.js", 0, False
