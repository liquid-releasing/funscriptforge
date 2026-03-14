# Troubleshooting — Installing FunscriptForge

Find your situation below. Each question is written the way you might actually think it —
not the way a manual would phrase it.

If your question isn't here, [ask the help assistant →](https://funscriptforge.com/help)
and if it turns out to be a common one, it will show up on this page.

---

## The app won't open at all

*You might be searching for: "FunscriptForge won't start", "nothing happens when I double-click",
"app doesn't launch"*

On Windows, make sure you extracted the zip before running — double-clicking inside a zip
without extracting first will fail silently. Right-click the zip → **Extract All…** first,
then run the exe from the extracted folder.

On macOS, you need to approve the app on first launch. Right-click → **Open** → **Open**
in the dialog. Skipping this step means the app is silently blocked by Gatekeeper.

---

## My browser opened but the page says "refused to connect" or "This site can't be reached"

*You might be searching for: "localhost refused to connect", "can't reach localhost:6789",
"browser opens but nothing loads"*

The server is still starting. Wait 5–10 seconds and refresh the tab. On the first launch
it takes longer because the app compiles templates — this only happens once.

If it still won't load after 30 seconds, close the launcher window, reopen it, and wait again.

---

## macOS says the app is damaged and can't be opened

*You might be searching for: "app is damaged", "can't be opened because Apple cannot check it",
"move to trash"*

This is a macOS quarantine flag, not actual damage. Open Terminal and run:

```bash
xattr -cr /Applications/FunscriptForge.app
```

Then try launching again. If you installed it somewhere other than Applications, replace
the path with wherever you put it.

---

## Windows Defender or my antivirus is blocking the download or the exe

*You might be searching for: "antivirus blocking FunscriptForge", "Windows Defender flagged it",
"virus warning", "false positive"*

PyInstaller-packaged apps are sometimes flagged by antivirus software because they bundle
a Python interpreter — which looks unusual to heuristic scanners.

FunscriptForge is open-source. You can read the full source code on GitHub before running it.

To proceed: add the FunscriptForge folder as an exception in your antivirus, or temporarily
disable real-time protection while you extract and first-run the app.

---

## The browser doesn't open automatically

*You might be searching for: "browser didn't open", "how do I open FunscriptForge",
"no browser window"*

Go to `http://localhost:6789` in any browser. The app is running — it just didn't
trigger the browser open. Bookmark that URL for next time.

---

## The app opens but crashes or freezes immediately

*You might be searching for: "FunscriptForge crashes on startup", "app freezes",
"app is unresponsive"*

Check that you have at least 4 GB of RAM free. Close other heavy applications
(browsers with many tabs, video editors, games) and try again.

---

## The app is very slow on the first load

*You might be searching for: "FunscriptForge slow", "takes forever to load", "spinning"*

This is normal on the first launch. The app compiles its UI templates once and caches them.
Subsequent launches are significantly faster. Give it up to 30 seconds on the first run.

---

## I'm on Linux and the binary won't run

*You might be searching for: "permission denied", "cannot execute", "FunscriptForge Linux"*

Mark the binary as executable first:

```bash
chmod +x ./FunscriptForge
./FunscriptForge
```

---

## My question isn't here

[Ask the help assistant →](https://funscriptforge.com/help)

Type your question the way you'd naturally ask it. If it's a question others are likely to
hit too, it will be added to this page. You're helping the next person by asking.

---

← [Back to: Install FunscriptForge](../01-getting-started/install.md)
