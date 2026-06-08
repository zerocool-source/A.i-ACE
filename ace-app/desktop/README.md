# ACE — desktop (Electron)

ACE as a native desktop app. A window wrapping the rigged 3D head and the app UI.

## Run it (your "dev server" for desktop)

```bash
cd ace-app/desktop
npm install
npm run dev        # prep copies the previews in, then opens the Electron window
```

`npm run dev` runs `electron .` — that's the desktop equivalent of a dev server: a
live app window. (Needs a desktop session; it can't run headless in CI/containers.)

## Make a macOS .dmg

A `.dmg` can only be built **on macOS**. Two ways:

**A. On a Mac (local):**
```bash
cd ace-app/desktop
npm install
npm run dist:mac   # → dist/ACE-0.1.0.dmg  (unsigned)
```

**B. No Mac? Build it in CI (recommended).** The workflow
`.github/workflows/build-desktop.yml` builds the `.dmg` on a GitHub-hosted macOS
runner and uploads it as an artifact:
1. GitHub → **Actions** → **Build ACE desktop (.dmg)** → **Run workflow** (or it runs
   automatically when `ace-app/desktop/**` changes).
2. Open the finished run → **Artifacts** → download **ACE-macos-dmg**.

The build is **unsigned** (no Apple Developer cert), so on first launch macOS shows
"unidentified developer" — right-click the app → **Open** → **Open** to allow it. To
ship signed/notarized later, add `CSC_LINK` + `CSC_KEY_PASSWORD` (and notarization
creds) to the workflow secrets.

Windows (`npm run dist:win`) and Linux (`npm run dist:linux`) targets are wired too.

## What the window loads
`scripts/prep.mjs` copies the committed self-contained previews into `renderer/`:
- `renderer/3d.html`  ← `../viewer3d/ace-3d.html` (rigged, animated head)
- `renderer/app.html` ← `../preview.html` (listen / ask / brain)
- `renderer/index.html` — a small landing linking both.

Swap what `main.js` loads if you want it to open straight into one of them.
