# AI / Contributor Guide

This repository includes driver-assistance and planning experiments. Treat anything related to driving as advisory only; the software must never encourage distraction or imply safety guarantees.

## Priorities
1. Do not add features that require visual interaction while a vehicle is moving.
2. AI output must be optional, clearly labeled, and never presented as a substitute for driver judgment or vehicle safety systems.
3. Keep sensitive location, camera, and personal data local unless the user explicitly chooses otherwise.
4. Never expose API keys or provider tokens in client code.
5. Add deterministic fallbacks and conservative timeouts for AI/network features.
6. Preserve PWA/offline behavior where present.
7. Use accessible, glanceable UI and minimize interaction steps.
8. Document experimental features and limitations in README/TESTING.md.

## Before merging
- Test without network/AI access.
- Verify no critical function depends on AI.
- Check that permissions are requested only when needed.
- Confirm no safety-critical claims are made.
- Check mobile layout and console errors.
