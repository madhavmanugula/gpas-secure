# GPAS Secure — private R2 File Vault test copy

This is a separate test copy. Keep your original `gpas-deploy_v1.zip` / Version 1 unchanged.

## What changed

- File Vault uploads use in-memory multipart handling and upload directly to a **private** Cloudflare R2 bucket.
- File objects are stored under `vault/<account>/<unique-id>-<filename>` and the existing `files.file_path` column stores the R2 object key. No database schema change is required.
- `/get-files` creates short-lived (5 minute) signed links for preview/download.
- Deletion checks that the file row belongs to the supplied username before deleting the R2 object and database row.
- The public `/uploads` static route and periodic cleanup are disabled to avoid exposing/deleting vault documents.
- Existing local `uploads/` files are shown only if they still exist, through a compatibility route. They are not migrated to R2 automatically.
- The `.env` file and `node_modules` are intentionally not included. Your original local `.env` was not changed.

## Configure R2

Set these variables in your **local `.env`** for local testing and separately in Render's Environment settings for deployment:

```env
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET_NAME=gpas-secure-vault
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
```

Use the exact S3 API endpoint shown in your Cloudflare R2 dashboard. Do not use a public bucket URL, `r2.dev` URL, or paste secrets into source code. Keep the bucket private.

## Local setup

1. Extract this ZIP to a **new folder**, not over your working project.
2. Copy your existing local `.env` into this new folder yourself; do not overwrite your original `.env`.
3. Add the four R2 variables above to the new copy's `.env`. Keep local MySQL values (`DB_HOST=localhost`, etc.) unchanged for local testing.
4. Open a terminal in the extracted folder and run:

   ```bash
   npm install
   npm start
   ```

   `npm install` is needed because the S3 SDK dependencies were added. This archive omits `package-lock.json` so npm can generate a lock file for the added dependencies.
5. Test with a non-sensitive sample file first: upload, refresh the dashboard, preview a PDF/image, download, delete, and verify the object disappears from the private R2 bucket.
6. Confirm another username cannot list/delete that row through the API before using this with real documents.

## Important security limitation before production

The original application performs the graphical-password match in browser JavaScript and relies on `localStorage` for the current username. Its existing `/login` endpoint returns the stored graphical-password points to the browser and does not establish a server-verified login session. This migration preserves that login flow to avoid unexpectedly breaking unrelated features, so **username checks in these File Vault routes are not a complete authentication boundary yet**. The R2 bucket remains private and signed links expire after five minutes, but an attacker who can call the API as another username may still request links. Do not treat this as production-secure until login verification/session authorization is moved server-side and every File Vault route checks that authenticated session.

## Existing files

This change does not copy existing `uploads/` files into R2, and it does not delete database rows for missing legacy files. If you need to migrate old files, do that as a separate controlled migration after checking which files are still available.


## Authentication hardening (V3 test build)
- Add `SESSION_SECRET` to your local `.env` and Render environment. Use a unique random value with at least 32 characters; do not share it or commit `.env`.
- Login now verifies the four graphical points on the server and sets a five-minute HttpOnly cookie. The public user lookup no longer returns stored secret points.
- File upload/list/delete and legacy-file access derive the account from the verified cookie, not a username sent by the browser. Admin APIs require the authenticated database account to have role `admin`.
- Test in a separate copy first. Existing browser localStorage is only used for display; it does not grant API access.

- Important: this is a security-hardening test build, not yet a production sign-off. Password-reset/OTP routes still need a separate server-side verification review before deploying publicly.
