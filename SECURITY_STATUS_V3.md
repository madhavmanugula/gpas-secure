# GPAS Secure V3 — security test build

This is a separate test copy. It does not change V1 or the deployed Render service.

## Changes made
- Graphical password points are verified by the backend during `POST /login`.
- The public `/user/:username` lookup returns the image only; it no longer exposes stored secret points.
- Successful login sets a five-minute signed, HttpOnly, SameSite=Lax cookie.
- Upload, list, delete, and legacy file reads derive the username from the verified cookie rather than trusting a browser-supplied username.
- Admin list/delete/promote/stats/audit endpoints require an authenticated account with the `admin` role.
- Frontend logout clears the authentication cookie.

## Required configuration
Add `SESSION_SECRET` to local `.env` and Render environment settings. Use a unique cryptographically random string of at least 32 characters. Do not share it, commit it, or paste it into chat. Render should set `NODE_ENV=production` so the cookie uses `Secure` over HTTPS.

## Do not deploy this build yet
Password-reset endpoints (`/get-image`, `/reset-password`, `/update-image-password`) still need a server-side OTP/authorization review. Login rate limiting is also still needed on the server; the current three-attempt lock in the browser can be bypassed. Test this V3 copy locally first, then complete those items before production deployment.

## Basic test checklist
1. Add `SESSION_SECRET` to local `.env`.
2. Start the app and log in with a correct graphical password.
3. In DevTools Network, confirm `POST /login` returns success and sets `gpas_session` as HttpOnly.
4. Open a private/incognito window and request `/get-files`; it should return HTTP 401.
5. In the logged-in window, upload, list, download, and delete a test file.
6. Log out; `/get-files` should return HTTP 401 again.
7. Attempt `/all-users` while logged in as a non-admin; it should return HTTP 403.


## Recovery hardening added in this test copy
- Recovery starts with a registered email or username using `POST /recovery/request`.
- A six-digit demo OTP is stored server-side, expires after five minutes, and allows at most five verification attempts.
- The demo OTP is displayed in the browser intentionally for demonstration. This is NOT proof of email ownership and must be replaced with delivery to the account's verified email before production.
- `POST /recovery/verify` exchanges a valid OTP for a short-lived, one-use recovery token.
- `/get-image`, `/reset-password`, and `/update-image-password` require that recovery token. Account identity comes from the server-side token, not an email supplied during the update.
- The two intended recovery options remain: existing image + new points, or new image + new points.
- Recovery tokens expire after five minutes and are consumed before credential mutation to prevent concurrent reuse. If an update fails after token consumption, the user must restart recovery.
- The uploaded image is limited to 300 KB; four click-points are validated server-side.

## Important remaining production work
- Do not deploy this test copy yet. The OTP is deliberately returned to the browser for the requested demo flow, so it does not securely verify account ownership.
- Before production, send the OTP to the user's registered/verified email using a mail provider, never return the OTP in the API response, and add rate limiting to OTP requests and login attempts.
- CORS now allows only localhost development origins, the known Render app origin, and any explicit origins listed in `CORS_ORIGINS` (comma-separated). Same-origin requests without an Origin header are allowed.
- The in-memory OTP/token maps are cleared when the server restarts and do not coordinate across multiple server instances. Use a shared store with TTL if deploying multiple instances.
- Run the complete local regression checklist, including login, session expiry, vault upload/list/download/delete, admin authorization, and both recovery options.
