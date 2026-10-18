# GPAS Secure — Local recovery hardening patch

This is a separate working copy based on the provided `gpas-deploy-v3-email-otp-test` project. It does not modify the original folder or Render.

## Changes in this patch
- Stores OTP challenges and recovery grants in MySQL, not process-local Maps.
- Stores request-ID hashes, HMAC-protected OTP digests, and recovery-token hashes.
- Keeps OTP and recovery grants valid for 5 minutes.
- Enforces at most 5 recovery requests per account in a rolling 24-hour window, a 60-second per-account cooldown, and at most 20 requests per IP in a rolling 24-hour window.
- Counts recovery attempts persistently and invalidates a challenge after 5 incorrect OTP attempts.
- Uses a MySQL transaction/row lock to consume a recovery grant together with the graphical-password update, blocking concurrent replay.
- Preserves a generic response for unknown account identifiers.

## Before running locally
1. Keep the original project folder unchanged. Extract this ZIP to a new folder.
2. Copy your local `.env` privately from your existing test folder into the new `gpas-project` folder. Never upload `.env` or share its contents.
3. Confirm `.env` points only to your LOCAL/test database. Do not use production DB credentials for this test.
4. Run `npm install`, then `node server.js`. The server creates the recovery tables automatically. The SQL migration is included for inspection/manual use.
5. Test in the browser before considering any deployment.

## Expected tests
- OTP email arrives; response contains no OTP.
- Same OTP cannot be verified twice.
- Wrong OTP is rejected and challenge is removed after 5 attempts.
- Sixth account request in the rolling 24-hour window is rejected; repeat inside 60 seconds is rejected.
- More than 20 requests from the same IP in 24 hours are rejected.
- A pending OTP and a recovery token continue to work after a local server restart if still within their expiry.
- A recovery token can reset the graphical password once only; replay should return HTTP 401.

## Important production notes
- Rate limits are enforced in MySQL, so they are shared between server instances. The IP limit depends on correctly configured Express `trust proxy`; review this setting for your actual hosting topology.
- Rate-limit records and expired recovery records need periodic cleanup. Add a scheduled cleanup job before sustained production use.
- This patch is not a full security certification. Do not deploy until the local regression/security tests pass and all production environment variables, database backups, SMTP, Cloudinary and R2 settings are reviewed.
