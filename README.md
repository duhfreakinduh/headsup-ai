# HeadsUp AI

**Fix it before it fixes your wallet.**

HeadsUp AI is an experimental, phone-first maintenance web app for homes, pools and vehicles. This repository is the personal/family prototype used to learn what is useful before spending money on servers or paid AI APIs.

## v0.1 goals

- Due-now and coming-soon maintenance dashboard
- Home/pool/vehicle task library with plain-English steps and safety levels
- Mark-done history and automatic next-due calculation
- 90-day maintenance cost forecast
- Browser-side semantic AI matching using a free Hugging Face Transformers.js embedding model
- Experimental on-device photo scout using a zero-shot vision model, loaded only when requested
- Local-only user data using `localStorage`
- Export/import JSON for backup and tester feedback
- Installable PWA with offline core screens

## AI design

The default AI does **retrieval, not hallucinated repair instructions**. It finds the most semantically relevant entries in the built-in maintenance library using `Xenova/all-MiniLM-L6-v2`. If the model cannot load, the app falls back to keyword matching.

Photo Scout is optional because the vision model is much larger. It uses `Xenova/clip-vit-base-patch32` for zero-shot image classification to suggest what kind of household/vehicle component may be in a photo, then maps that suggestion back to the same grounded maintenance library. Results are labeled experimental and should not be treated as a safety diagnosis.

No API key is required. Models run in the browser through Transformers.js after their files are downloaded from Hugging Face.

## Safety

HeadsUp AI is a maintenance organizer and test prototype, not a substitute for manufacturer instructions or licensed professionals. Gas/propane leaks, energized electrical faults, pressurized pool filters and other high-risk situations intentionally show stop/call-a-pro guidance.

## Run locally

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy

A GitHub Pages workflow is included. In repository **Settings → Pages**, set the Source to **GitHub Actions** once, then pushes to `main` deploy automatically.
