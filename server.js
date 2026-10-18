require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v2: cloudinary } = require("cloudinary");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();
const PORT = process.env.PORT || 3001;
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log("🔥 SERVER FILE LOADED:", __filename, "PORT:", PORT);

/* ================= MIDDLEWARE ================= */
app.set("trust proxy", 1);
const allowedOrigins = new Set([
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "https://gpas-secure.onrender.com",
  ...(process.env.CORS_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)
]);
app.use(cors({
  origin(origin, callback) {
    // Allow same-origin/non-browser requests with no Origin header; allow only listed browser origins.
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
// File Vault uploads are private. Do not expose the local uploads directory as static files.
// Legacy local files are served only through the ownership-checked /legacy-file route below.

// Authentication uses a short-lived signed HttpOnly cookie. Set SESSION_SECRET to a long random value.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.warn("WARNING: SESSION_SECRET is missing/short. Login will be unavailable until it is configured (32+ characters required).");
}
function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function readSession(req) {
  try {
    const raw = String(req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith("gpas_session="));
    if (!raw || !SESSION_SECRET) return null;
    const token = decodeURIComponent(raw.slice("gpas_session=".length));
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!data.username || !data.exp || Date.now() >= data.exp) return null;
    return data;
  } catch (_) { return null; }
}
function setSessionCookie(res, username) {
  const token = signSession({ username, exp: Date.now() + 5 * 60 * 1000, nonce: crypto.randomUUID() });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `gpas_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300${secure}`);
}
function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `gpas_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}
async function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ success: false, error: "Please log in again." });
  try {
    const [rows] = await db.execute("SELECT username, role FROM users WHERE username=?", [session.username]);
    if (!rows.length) { clearSessionCookie(res); return res.status(401).json({ success: false, error: "Account not found." }); }
    req.auth = { username: rows[0].username, role: rows[0].role || "user" };
    next();
  } catch (err) { return res.status(500).json({ success: false, error: "Authentication check failed." }); }
}
function requireAdmin(req, res, next) {
  if (!req.auth || req.auth.role !== "admin") return res.status(403).json({ success: false, error: "Admin access required." });
  next();
}



/* ================= MYSQL POOL ================= */

const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === "true"
        ? { rejectUnauthorized: false }
        : undefined,
    waitForConnections: true,
    connectionLimit: 10
});

/* test connection */
(async () => {
    try {
        await db.query("SELECT 1");
        await db.query(`
          CREATE TABLE IF NOT EXISTS audit_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255),
            action VARCHAR(255),
            meta TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await db.query(`CREATE TABLE IF NOT EXISTS recovery_challenges (
          request_id_hash CHAR(64) PRIMARY KEY,
          username VARCHAR(255) NOT NULL,
          email VARCHAR(254) NOT NULL,
          otp_hash CHAR(64) NOT NULL,
          expires_at_ms BIGINT NOT NULL,
          attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
          created_at_ms BIGINT NOT NULL,
          INDEX idx_recovery_challenges_expiry (expires_at_ms),
          INDEX idx_recovery_challenges_user (username)
        ) ENGINE=InnoDB`);
        await db.query(`CREATE TABLE IF NOT EXISTS recovery_grants (
          token_hash CHAR(64) PRIMARY KEY,
          username VARCHAR(255) NOT NULL,
          expires_at_ms BIGINT NOT NULL,
          created_at_ms BIGINT NOT NULL,
          INDEX idx_recovery_grants_expiry (expires_at_ms),
          INDEX idx_recovery_grants_user (username)
        ) ENGINE=InnoDB`);
        await db.query(`CREATE TABLE IF NOT EXISTS recovery_rate_limits (
          rate_key CHAR(64) PRIMARY KEY,
          window_started_at_ms BIGINT NOT NULL,
          request_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
          last_requested_at_ms BIGINT NOT NULL DEFAULT 0,
          updated_at_ms BIGINT NOT NULL,
          INDEX idx_recovery_rate_updated (updated_at_ms)
        ) ENGINE=InnoDB`);
        console.log("✅ MySQL Connected");
    } catch (err) {
        console.error("❌ MySQL Error:", err.message);
    }
})();

function logAction(req, username, action, meta = "") {
    const ip =
      (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
        .toString()
        .split(",")[0]
        .trim();
    const payload = JSON.stringify({ meta, ip });

    db.query(
        "INSERT INTO audit_logs (username, action, meta) VALUES (?, ?, ?)",
        [username || "unknown", action, payload]
    ).catch((err) => {
        console.error("AUDIT LOG ERROR:", err.message);
    });
}



/* ================= PRIVATE FILE VAULT STORAGE ================= */
const r2Configured = Boolean(
    process.env.R2_ENDPOINT &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
);

const r2 = r2Configured ? new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
}) : null;

// Keep files in memory only long enough to upload them to R2; do not write vault files to Render disk.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
});

const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 300 * 1024 }
});

function safeFileName(name) {
    const base = path.basename(String(name || "file")).replace(/[^a-zA-Z0-9._-]/g, "_");
    return base.slice(-150) || "file";
}

function getLegacyUploadPath(rawPath) {
    const normalized = String(rawPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized.startsWith("uploads/")) return null;
    const uploadsRoot = path.resolve(__dirname, "uploads");
    const resolved = path.resolve(__dirname, normalized);
    return resolved.startsWith(uploadsRoot + path.sep) ? resolved : null;
}

/* =====================================================
   REGISTER USER
===================================================== */
app.post("/register", imageUpload.single("image"), async (req, res) => {

    try {
        const { username, email, points } = req.body;

        if (!username || !email || !points || !req.file)
            return res.status(400).json({ success: false });

        // 🔥 FIXED PATH
      const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
            folder: "gpas-secure/users",
            public_id: username,
            overwrite: false
        },
        (error, result) => {
            if (error) reject(error);
            else resolve(result);
        }
    );

    stream.end(req.file.buffer);
});

const imagePath = result.secure_url;

        await db.execute(
            `INSERT INTO users (username, email, image_path, points)
             VALUES (?, ?, ?, ?)`,
            [username, email, imagePath, points]
        );

        res.json({ success: true });

    } catch (err) {
        console.error("🔥 Register error:", err.message);
        res.status(500).json({ success: false });
    }
});


/* =====================================================
   FETCH USER IMAGE + POINTS (FOR LOGIN)
===================================================== */
app.get("/user/:username", async (req, res) => {

    try {
        const [rows] = await db.execute(
            "SELECT image_path FROM users WHERE username=?",
            [req.params.username]
        );

        if (!rows.length) {
            return res.json({ success: false });
        }

        return res.json({
            success: true,
            image_path: rows[0].image_path
        });

    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
});




/* SERVER-SIDE GRAPHICAL PASSWORD VERIFICATION */
app.post("/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const points = req.body.points;
    if (!SESSION_SECRET || SESSION_SECRET.length < 32) return res.status(503).json({ success: false, error: "Server session security is not configured." });
    if (!username || !Array.isArray(points) || points.length !== 4 || points.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) {
      logAction(req, username, "Failed Login", "Invalid login payload");
      return res.status(400).json({ success: false, error: "Enter username and click the four secret points." });
    }
    const [rows] = await db.execute("SELECT username, points FROM users WHERE username=?", [username]);
    if (!rows.length) {
      logAction(req, username, "Failed Login");
      return res.status(401).json({ success: false, error: "Invalid username or graphical password." });
    }
    let saved;
    try { saved = typeof rows[0].points === "string" ? JSON.parse(rows[0].points) : rows[0].points; } catch (_) { saved = null; }
    const close = (a, b) => a && b && Number.isFinite(Number(a.x)) && Number.isFinite(Number(a.y)) && Math.hypot(Number(a.x)-Number(b.x), Number(a.y)-Number(b.y)) <= 5;
    const valid = Array.isArray(saved) && saved.length === 4 && saved.every((point, i) => close(points[i], point));
    if (!valid) {
      logAction(req, username, "Failed Login", "Graphical password mismatch");
      return res.status(401).json({ success: false, error: "Invalid username or graphical password." });
    }
    setSessionCookie(res, rows[0].username);
    logAction(req, username, "Login");
    return res.json({ success: true, username: rows[0].username });
  } catch (err) {
    console.error("LOGIN ERROR:", err.message);
    return res.status(500).json({ success: false, error: "Login failed. Please try again." });
  }
});
app.post("/logout", (req, res) => { clearSessionCookie(res); res.json({ success: true }); });
app.get("/session", requireAuth, (req, res) => res.json({ success: true, username: req.auth.username, role: req.auth.role }));

/* ================= PRODUCTION-STYLE PASSWORD RECOVERY =================
   Recovery state is persisted in MySQL; only hashed request IDs, OTPs and grants
   are stored. Limits: 5 requests/account/rolling 24h, 60s account cooldown,
   and 20 requests/IP/rolling 24h. OTP/grant lifetime: 5 minutes.
*/
const OTP_TTL_MS = 5 * 60 * 1000;
const RECOVERY_GRANT_TTL_MS = 5 * 60 * 1000;
const RECOVERY_DAY_MS = 24 * 60 * 60 * 1000;
const RECOVERY_ACCOUNT_DAILY_LIMIT = 5;
const RECOVERY_IP_DAILY_LIMIT = 20;
const RECOVERY_COOLDOWN_MS = 60 * 1000;

const smtpConfigured = Boolean(
    process.env.SMTP_HOST && process.env.SMTP_PORT &&
    process.env.SMTP_USER && process.env.SMTP_PASS
);
const mailer = smtpConfigured ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: String(process.env.SMTP_PASS).replace(/\s+/g, "") },
    requireTLS: Number(process.env.SMTP_PORT) === 587
}) : null;

function sha256(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}
function otpDigest(requestId, otp) {
    // HMAC prevents easy offline guessing of the six-digit OTP if the DB is copied.
    return crypto.createHmac("sha256", SESSION_SECRET || "missing-session-secret")
        .update(`${requestId}:${otp}`).digest("hex");
}
function constantTimeHexEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    const aa = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}
function recoveryClientIp(req) {
    // req.ip honours Express trust-proxy configuration; don't parse arbitrary headers here.
    return String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 100);
}
function rateKey(scope, value) {
    return sha256(`gpas-recovery-rate:v1:${scope}:${String(value).trim().toLowerCase()}`);
}

async function enforceRecoveryRateLimit(req, accountKey) {
    const now = Date.now();
    const keys = [
        { key: rateKey("account", accountKey), limit: RECOVERY_ACCOUNT_DAILY_LIMIT, cooldown: RECOVERY_COOLDOWN_MS, label: "account" },
        { key: rateKey("ip", recoveryClientIp(req)), limit: RECOVERY_IP_DAILY_LIMIT, cooldown: 0, label: "network" }
    ];
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        for (const item of keys) {
            await conn.execute(
                `INSERT IGNORE INTO recovery_rate_limits
                 (rate_key, window_started_at_ms, request_count, last_requested_at_ms, updated_at_ms)
                 VALUES (?, ?, 0, 0, ?)`, [item.key, now, now]
            );
        }
        const locked = [];
        for (const item of keys) {
            const [rows] = await conn.execute(
                "SELECT window_started_at_ms, request_count, last_requested_at_ms FROM recovery_rate_limits WHERE rate_key=? FOR UPDATE",
                [item.key]
            );
            locked.push({ ...item, row: rows[0] });
        }
        for (const item of locked) {
            const row = item.row;
            const expiredWindow = now - Number(row.window_started_at_ms) >= RECOVERY_DAY_MS;
            const count = expiredWindow ? 0 : Number(row.request_count);
            const last = expiredWindow ? 0 : Number(row.last_requested_at_ms);
            if (count >= item.limit) {
                const retryAfterSeconds = Math.max(1, Math.ceil((Number(row.window_started_at_ms) + RECOVERY_DAY_MS - now) / 1000));
                await conn.rollback();
                return { allowed: false, retryAfterSeconds, reason: item.label };
            }
            if (item.cooldown && last && now - last < item.cooldown) {
                const retryAfterSeconds = Math.max(1, Math.ceil((last + item.cooldown - now) / 1000));
                await conn.rollback();
                return { allowed: false, retryAfterSeconds, reason: "cooldown" };
            }
        }
        for (const item of locked) {
            const row = item.row;
            const expiredWindow = now - Number(row.window_started_at_ms) >= RECOVERY_DAY_MS;
            await conn.execute(
                `UPDATE recovery_rate_limits
                 SET window_started_at_ms=?, request_count=?, last_requested_at_ms=?, updated_at_ms=?
                 WHERE rate_key=?`,
                [expiredWindow ? now : Number(row.window_started_at_ms), (expiredWindow ? 0 : Number(row.request_count)) + 1, now, now, item.key]
            );
        }
        await conn.commit();
        return { allowed: true };
    } catch (err) {
        try { await conn.rollback(); } catch (_) {}
        throw err;
    } finally {
        conn.release();
    }
}

async function findRecoveryGrant(token) {
    if (!token || typeof token !== "string" || token.length > 256) return null;
    const [rows] = await db.execute(
        "SELECT username, expires_at_ms FROM recovery_grants WHERE token_hash=? LIMIT 1",
        [sha256(token)]
    );
    if (!rows.length) return null;
    if (Date.now() >= Number(rows[0].expires_at_ms)) {
        await db.execute("DELETE FROM recovery_grants WHERE token_hash=?", [sha256(token)]);
        return null;
    }
    return { username: rows[0].username, expiresAt: Number(rows[0].expires_at_ms) };
}

async function consumeRecoveryGrant(token, updateWork) {
    if (!token || typeof token !== "string" || token.length > 256) return { consumed: false };
    const tokenHash = sha256(token);
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.execute(
            "SELECT username, expires_at_ms FROM recovery_grants WHERE token_hash=? FOR UPDATE", [tokenHash]
        );
        if (!rows.length || Date.now() >= Number(rows[0].expires_at_ms)) {
            await conn.execute("DELETE FROM recovery_grants WHERE token_hash=?", [tokenHash]);
            await conn.commit();
            return { consumed: false };
        }
        const grant = { username: rows[0].username, expiresAt: Number(rows[0].expires_at_ms) };
        // The credential update and token deletion commit together; concurrent replays lose the row lock.
        await updateWork(conn, grant);
        await conn.execute("DELETE FROM recovery_grants WHERE token_hash=?", [tokenHash]);
        await conn.commit();
        return { consumed: true, grant };
    } catch (err) {
        try { await conn.rollback(); } catch (_) {}
        throw err;
    } finally {
        conn.release();
    }
}

function validGraphicalPoints(points) {
    return Array.isArray(points) && points.length === 4 &&
        points.every(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) &&
            Number(p.x) >= 0 && Number(p.x) <= 100 && Number(p.y) >= 0 && Number(p.y) <= 100);
}

app.post("/recovery/request", async (req, res) => {
    try {
        const identifier = String(req.body?.identifier || "").trim();
        if (!identifier || identifier.length > 254) {
            return res.status(400).json({ success: false, error: "Enter your registered email or username." });
        }
        if (!mailer) {
            console.error("SMTP is not configured; recovery email was not sent.");
            return res.status(503).json({ success: false, error: "Email recovery is temporarily unavailable. Please try again later." });
        }
        const [rows] = await db.execute(
            "SELECT username, email FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?) LIMIT 1",
            [identifier, identifier]
        );
        const account = rows.length && rows[0].email ? rows[0] : null;
        const accountKey = account ? `user:${account.username}` : `identifier:${identifier}`;
        const limit = await enforceRecoveryRateLimit(req, accountKey);
        if (!limit.allowed) {
            // Do not reveal whether an identifier belongs to an account. For account-scoped
            // limits, return the same generic response and send no email. IP limits are global
            // to the requester and can safely return 429.
            if (limit.reason === "network") {
                res.setHeader("Retry-After", String(limit.retryAfterSeconds));
                return res.status(429).json({ success: false, error: "Too many recovery requests. Please try again later." });
            }
            return res.json({ success: true, message: "If the account exists with a registered email, a recovery code will be sent." });
        }
        // Same public response for unknown accounts, without sending mail to user-supplied addresses.
        if (!account) {
            return res.json({ success: true, message: "If the account exists with a registered email, a recovery code will be sent." });
        }
        const email = String(account.email).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.json({ success: true, message: "If the account exists with a registered email, a recovery code will be sent." });
        }
        const requestId = crypto.randomBytes(24).toString("hex");
        const requestIdHash = sha256(requestId);
        const otp = String(crypto.randomInt(100000, 1000000));
        const expiresAt = Date.now() + OTP_TTL_MS;
        // Persist before sending so a process restart does not erase a pending OTP.
        await db.execute(
            `INSERT INTO recovery_challenges (request_id_hash, username, email, otp_hash, expires_at_ms, attempts, created_at_ms)
             VALUES (?, ?, ?, ?, ?, 0, ?)`,
            [requestIdHash, account.username, email, otpDigest(requestId, otp), expiresAt, Date.now()]
        );
        try {
            await mailer.sendMail({
                from: `"GPAS Secure" <${process.env.SMTP_USER}>`,
                to: email,
                subject: "GPAS Secure password recovery code",
                text: `Your GPAS Secure recovery code is ${otp}.\n\nIt expires in 5 minutes. If you did not request this code, ignore this email. Do not share it with anyone.`,
                html: `<p>Your GPAS Secure recovery code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${otp}</p><p>This code expires in 5 minutes. If you did not request it, ignore this email. Do not share it with anyone.</p>`
            });
        } catch (mailErr) {
            await db.execute("DELETE FROM recovery_challenges WHERE request_id_hash=?", [requestIdHash]);
            throw mailErr;
        }
        return res.json({
            success: true,
            requestId,
            message: "If the account exists with a registered email, a recovery code will be sent.",
            expiresInSeconds: OTP_TTL_MS / 1000
        });
    } catch (err) {
        console.error("RECOVERY REQUEST ERROR:", err.message);
        return res.status(500).json({ success: false, error: "Could not send recovery email. Please try again later." });
    }
});

app.post("/recovery/verify", async (req, res) => {
    const requestId = String(req.body?.requestId || "");
    const enteredOtp = String(req.body?.otp || "").trim();
    if (!/^[0-9a-f]{48}$/i.test(requestId) || !/^\d{6}$/.test(enteredOtp)) {
        return res.status(400).json({ success: false, error: "OTP expired or invalid. Request a new one." });
    }
    const requestIdHash = sha256(requestId);
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.execute(
            "SELECT username, otp_hash, expires_at_ms, attempts FROM recovery_challenges WHERE request_id_hash=? FOR UPDATE",
            [requestIdHash]
        );
        if (!rows.length || Date.now() >= Number(rows[0].expires_at_ms)) {
            await conn.execute("DELETE FROM recovery_challenges WHERE request_id_hash=?", [requestIdHash]);
            await conn.commit();
            return res.status(400).json({ success: false, error: "OTP expired or invalid. Request a new one." });
        }
        const challenge = rows[0];
        const attempts = Number(challenge.attempts) + 1;
        const expected = String(challenge.otp_hash);
        const valid = constantTimeHexEqual(otpDigest(requestId, enteredOtp), expected);
        if (!valid) {
            if (attempts >= 5) {
                await conn.execute("DELETE FROM recovery_challenges WHERE request_id_hash=?", [requestIdHash]);
            } else {
                await conn.execute("UPDATE recovery_challenges SET attempts=? WHERE request_id_hash=?", [attempts, requestIdHash]);
            }
            await conn.commit();
            return res.status(attempts >= 5 ? 429 : 400).json({ success: false, error: attempts >= 5 ? "Too many attempts. Request a new OTP." : "Incorrect OTP." });
        }
        await conn.execute("DELETE FROM recovery_challenges WHERE request_id_hash=?", [requestIdHash]);
        const recoveryToken = crypto.randomBytes(32).toString("hex");
        const now = Date.now();
        await conn.execute(
            "INSERT INTO recovery_grants (token_hash, username, expires_at_ms, created_at_ms) VALUES (?, ?, ?, ?)",
            [sha256(recoveryToken), challenge.username, now + RECOVERY_GRANT_TTL_MS, now]
        );
        await conn.commit();
        return res.json({ success: true, recoveryToken, expiresInSeconds: RECOVERY_GRANT_TTL_MS / 1000 });
    } catch (err) {
        try { await conn.rollback(); } catch (_) {}
        console.error("OTP VERIFY ERROR:", err.message);
        return res.status(500).json({ success: false, error: "Could not verify recovery code. Please try again." });
    } finally {
        conn.release();
    }
});

app.get("/get-image", async (req, res) => {
    try {
        const grant = await findRecoveryGrant(String(req.query.recoveryToken || ""));
        if (!grant) return res.status(401).json({ success: false, error: "Recovery verification expired. Start again." });
        const [rows] = await db.execute("SELECT image_path FROM users WHERE username=? LIMIT 1", [grant.username]);
        if (!rows.length) return res.status(404).json({ success: false, error: "Account image not found." });
        return res.json({ success: true, image: rows[0].image_path });
    } catch (err) {
        console.error("GET RECOVERY IMAGE ERROR:", err.message);
        return res.status(500).json({ success: false, error: "Could not load the account image." });
    }
});

app.post("/reset-password", async (req, res) => {
    try {
        const recoveryToken = String(req.body?.recoveryToken || "");
        const points = req.body?.points;
        if (!validGraphicalPoints(points)) return res.status(400).json({ success: false, error: "Select exactly four valid points." });
        const result = await consumeRecoveryGrant(recoveryToken, async (conn, grant) => {
            const [updated] = await conn.execute("UPDATE users SET points=? WHERE username=?", [JSON.stringify(points), grant.username]);
            if (!updated.affectedRows) throw new Error("Recovery account no longer exists");
        });
        if (!result.consumed) return res.status(401).json({ success: false, error: "Recovery verification expired or already used. Start again." });
        logAction(req, result.grant.username, "password_reset", "Graphical password changed after email OTP verification");
        return res.json({ success: true });
    } catch (err) {
        console.error("RESET ERROR:", err.message);
        return res.status(500).json({ success: false, error: "Could not update graphical password." });
    }
});

app.post("/update-image-password", imageUpload.single("image"), async (req, res) => {
    try {
        const recoveryToken = String(req.body?.recoveryToken || "");
        let points;
        try { points = JSON.parse(req.body?.points || "null"); }
        catch (_) { return res.status(400).json({ success: false, error: "Invalid point data." }); }
        if (!validGraphicalPoints(points)) return res.status(400).json({ success: false, error: "Select exactly four valid points." });
        if (!req.file) return res.status(400).json({ success: false, error: "Choose a new image." });
        if (!req.file.mimetype?.startsWith("image/") || req.file.size > 300 * 1024) {
            return res.status(400).json({ success: false, error: "Choose an image smaller than 300 KB." });
        }
        // Upload first; only consume the one-time grant when the DB change can commit.
        const existingGrant = await findRecoveryGrant(recoveryToken);
        if (!existingGrant) return res.status(401).json({ success: false, error: "Recovery verification expired. Start again." });
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: "gpas-secure/users", public_id: existingGrant.username, overwrite: true, resource_type: "image" },
                (error, uploadResult) => error ? reject(error) : resolve(uploadResult)
            );
            stream.end(req.file.buffer);
        });
        const newPath = result.secure_url;
        const consumed = await consumeRecoveryGrant(recoveryToken, async (conn, grant) => {
            if (grant.username !== existingGrant.username) throw new Error("Recovery grant changed unexpectedly");
            const [updated] = await conn.execute("UPDATE users SET image_path=?, points=? WHERE username=?", [newPath, JSON.stringify(points), grant.username]);
            if (!updated.affectedRows) throw new Error("Recovery account no longer exists");
        });
        if (!consumed.consumed) return res.status(401).json({ success: false, error: "Recovery verification expired or already used. Start again." });
        logAction(req, consumed.grant.username, "image_and_password_reset", "Profile image and graphical password changed after email OTP verification");
        return res.json({ success: true });
    } catch (err) {
        console.error("UPDATE IMAGE + PASSWORD ERROR:", err.message);
        return res.status(500).json({ success: false, error: "Could not update image and graphical password." });
    }
});

app.post("/upload-file", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!r2Configured || !r2) {
      return res.status(503).json({ success: false, error: "Private file storage is not configured on the server." });
    }
    const username = req.auth.username;
    if (!req.file) return res.status(400).json({ success: false, error: "A file is required." });

    const keyUsername = username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
    const key = `vault/${keyUsername}/${crypto.randomUUID()}-${safeFileName(req.file.originalname)}`;
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || "application/octet-stream",
      Metadata: { originalname: safeFileName(req.file.originalname) }
    }));

    try {
      await db.execute("INSERT INTO files (username,file_path) VALUES (?,?)", [username, key]);
    } catch (dbErr) {
      // Avoid leaving an orphaned R2 object if the database insert fails.
      await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key })).catch(() => {});
      throw dbErr;
    }

    logAction(req, username, "Uploaded File", safeFileName(req.file.originalname));
    res.json({ success: true });
  } catch (err) {
    console.error("UPLOAD ERROR:", err.message);
    res.status(500).json({ success: false, error: "Upload failed. Please try again." });
  }
});

/* FILE VAULT: list a user's R2 files and short-lived signed links */
app.get("/get-files", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const [rows] = await db.execute("SELECT file_path FROM files WHERE username=? ORDER BY file_path DESC", [username]);
    const files = [];

    for (const row of rows) {
      const rawPath = String(row.file_path || "").replace(/\\/g, "/");
      if (rawPath.startsWith("vault/")) {
        if (!r2Configured || !r2) continue;
        const name = rawPath.split("/").pop().replace(/^[0-9a-f-]{36}-/i, "");
        const inlineUrl = await getSignedUrl(r2, new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: rawPath,
          ResponseContentDisposition: `inline; filename="${safeFileName(name)}"`
        }), { expiresIn: 300 });
        const downloadUrl = await getSignedUrl(r2, new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: rawPath,
          ResponseContentDisposition: `attachment; filename="${safeFileName(name)}"`
        }), { expiresIn: 300 });
        files.push({ key: rawPath, name, url: inlineUrl, downloadUrl, legacy: false });
        continue;
      }

      // Backward compatibility for files that still exist on the local machine.
      const legacyPath = getLegacyUploadPath(rawPath);
      if (legacyPath && fs.existsSync(legacyPath)) {
        const name = path.basename(legacyPath);
        const encodedPath = encodeURIComponent(rawPath);
        const url = `/legacy-file?path=${encodedPath}`;
        files.push({ key: rawPath, name, url, downloadUrl: `${url}&download=1`, legacy: true });
      }
      // Do not delete missing legacy rows automatically; an R2 key or a temporarily unavailable disk
      // must never cause a database row to be silently removed.
    }
    res.json({ files });
  } catch (err) {
    console.error("GET FILES ERROR:", err.message);
    res.status(500).json({ files: [], error: "Could not load files." });
  }
});

/* Serve legacy local files only after checking the requested username owns the database row. */
app.get("/legacy-file", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const rawPath = String(req.query.path || "").replace(/\\/g, "/");
    const [rows] = await db.execute("SELECT file_path FROM files WHERE username=? AND file_path=?", [username, rawPath]);
    const localPath = getLegacyUploadPath(rawPath);
    if (!rows.length || !localPath || !fs.existsSync(localPath)) return res.status(404).send("File not found");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${safeFileName(path.basename(localPath))}"`);
    res.sendFile(localPath);
  } catch (err) {
    console.error("LEGACY FILE ERROR:", err.message);
    res.status(500).send("Could not open file");
  }
});

/* FILE VAULT: delete only a key belonging to the supplied account */
app.post("/delete-file", requireAuth, async (req, res) => {
  try {
    const username = req.auth.username;
    const fileKey = String(req.body.path || req.body.key || "").replace(/\\/g, "/");
    if (!fileKey) return res.status(400).json({ success: false, error: "File is required." });
    const [rows] = await db.execute("SELECT file_path FROM files WHERE username=? AND file_path=?", [username, fileKey]);
    if (!rows.length) return res.status(404).json({ success: false, error: "File not found for this account." });

    if (fileKey.startsWith("vault/")) {
      if (!r2Configured || !r2) return res.status(503).json({ success: false, error: "Private file storage is not configured." });
      await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: fileKey }));
    } else {
      const localPath = getLegacyUploadPath(fileKey);
      if (!localPath) return res.status(400).json({ success: false, error: "Invalid file path." });
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    }

    await db.execute("DELETE FROM files WHERE username=? AND file_path=?", [username, fileKey]);
    logAction(req, username, "Deleted File", path.basename(fileKey));
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ERROR:", err.message);
    res.status(500).json({ success: false, error: "Delete failed. Please try again." });
  }
});

/* Legacy cleanup endpoint retained for compatibility, but never deletes files automatically. */
async function cleanupUploads() {
  return [];
}

app.post("/cleanup-uploads", requireAuth, async (req, res) => {
  res.json({ success: true, deletedCount: 0, deleted: [], message: "Automatic file deletion is disabled for safe cloud storage." });
});

/* ALL USERS */
app.get("/all-users", requireAuth, requireAdmin, async (req,res)=>{
  try {
    const [rows] = await db.execute("SELECT username, role FROM users");
    res.json({ users: rows });
  } catch (err) {
    console.error("ALL USERS ERROR:", err.message);
    res.status(500).json({ error: "Could not load users." });
  }
});


/* DELETE USER */
app.post("/delete-user", requireAuth, requireAdmin, async (req,res)=>{

  const { username } = req.body;
  if (!username || username === req.auth.username) return res.status(400).json({success:false, error:"Invalid target account."});
  await db.execute("DELETE FROM users WHERE username=?",[username]);
  logAction(req, req.auth.username, "Deleted User", username);

  res.json({success:true});
});

/* MAKE ADMIN */
app.post("/make-admin", requireAuth, requireAdmin, async (req,res)=>{

  const { username } = req.body;
  if (!username) return res.status(400).json({success:false, error:"Username is required."});
  await db.execute(
    "UPDATE users SET role='admin' WHERE username=?",
    [username]
  );
  logAction(req, req.auth.username, "Promoted User", username);

  res.json({success:true});
});

/* ADMIN STATS (REAL ANALYTICS) */
app.get("/admin-stats", requireAuth, requireAdmin, async (req, res) => {
  try {
    // TOTAL USERS
    const [users] = await db.execute(
      "SELECT COUNT(*) as total FROM users"
    );

    // TOTAL FILES
    const [files] = await db.execute(
      "SELECT COUNT(*) as total FROM files"
    );

    // FILES PER DAY (last 7 days)
    const [daily] = await db.execute(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM audit_logs
      WHERE action LIKE '%Upload%'
      AND created_at >= CURDATE() - INTERVAL 7 DAY
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    res.json({
      users: users[0].total,
      files: files[0].total,
      daily: daily
    });

  } catch (err) {
    console.error("❌ Stats error:", err.message);
    res.json({ error: true });
  }
});

app.get("/audit-logs", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT *,
      CASE
        WHEN action LIKE '%Failed%' THEN 1
        ELSE 0
      END AS suspicious
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT 50
    `);

    const enriched = rows.map((log) => {
      let parsedMeta = {};
      try {
        parsedMeta = JSON.parse(log.meta || "{}");
      } catch (err) {
        parsedMeta = { meta: String(log.meta || "") };
      }
      return { ...log, parsedMeta };
    });

    const suspiciousMarked = enriched.map((log) => {
      let suspicious = Number(log.suspicious) === 1;
      const createdAt = new Date(log.created_at).getTime();

      if (log.action === "Failed Login" && log.username) {
        const recentFails = enriched.filter((entry) => {
          if (entry.action !== "Failed Login" || entry.username !== log.username) return false;
          const entryTime = new Date(entry.created_at).getTime();
          return Math.abs(entryTime - createdAt) <= 5 * 60 * 1000;
        }).length;
        if (recentFails >= 3) suspicious = true;
      }

      if (log.action === "Uploaded File" && log.username) {
        const fastUploads = enriched.filter((entry) => {
          if (entry.action !== "Uploaded File" || entry.username !== log.username) return false;
          const entryTime = new Date(entry.created_at).getTime();
          return Math.abs(entryTime - createdAt) <= 5 * 60 * 1000;
        }).length;
        if (fastUploads >= 5) suspicious = true;
      }

      return { ...log, suspicious: suspicious ? 1 : 0 };
    });

    res.json(suspiciousMarked);
  } catch (err) {
    console.error("AUDIT FETCH ERROR:", err.message);
    res.status(500).json([]);
  }
});

/* ================= START SERVER ================= */
app.listen(PORT, () => {
    console.log(`🚀 GPAS Server running at http://localhost:${PORT}`);
});

// Automatic local cleanup is intentionally disabled: vault files live in private R2 storage.
