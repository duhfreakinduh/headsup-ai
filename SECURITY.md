# Security Policy

## Reporting a vulnerability
Do not post secrets, private URLs, precise location data, camera data, exploit details, or sensitive logs in a public issue. Use GitHub private vulnerability reporting if enabled; otherwise open only a minimal issue until a private channel is established.

## Security expectations
- Never commit credentials or provider tokens.
- Treat location, camera, and driver-related data as sensitive.
- Do not send sensitive data to remote AI without explicit user action and disclosure.
- Do not represent experimental software as a safety system or guarantee.
- Bound AI/network calls with timeouts and safe fallbacks.
- Review permissions and third-party dependency/CDN changes before release.
