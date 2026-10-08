require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3001;

console.log("🔥 SERVER FILE LOADED:", __filename, "PORT:", PORT);

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));



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



/* ================= MULTER (UPLOAD) ================= */
const storage = multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage });



/* =====================================================
   REGISTER USER
===================================================== */
app.post("/register", upload.single("image"), async (req, res) => {

    try {
        const { username, email, points } = req.body;

        if (!username || !email || !points || !req.file)
            return res.status(400).json({ success: false });

        // 🔥 FIXED PATH
        const imagePath = req.file.path.replace(/\\/g, "/");

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
            "SELECT image_path, points FROM users WHERE username=?",
            [req.params.username]
        );

        if (!rows.length) {
            return res.json({ success: false });
        }

        return res.json({
            success: true,
            image_path: rows[0].image_path,
            points: rows[0].points
        });

    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
});




/* =====================================================
   LOGIN CHECK (OPTIONAL FUTURE)
===================================================== */
app.post("/login", async (req, res) => {

    try {
        const { username } = req.body;

        const [rows] = await db.execute(
            "SELECT image_path, points FROM users WHERE username=?",
            [username]
        );

        if (!rows.length) {
            logAction(req, username, "Failed Login");
            return res.json({ success: false });
        }

        logAction(req, username, "Login");

        res.json(rows[0]); // send image + points

    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
});

/* =====================================================
   GET IMAGE FOR RESET PASSWORD
===================================================== */

app.get("/get-image", async (req, res) => {

    try {
        const email = req.query.email;
        console.log("🔥 GET IMAGE REQUEST - EMAIL:", email);   // 🔥 DEBUG

        const [rows] = await db.execute(
            "SELECT image_path, points FROM users WHERE email=?",
            [email]
        );

        console.log("🔥 DB RESULT:", rows);  // 🔥 DEBUG

        if (!rows.length) {
            console.log("❌ USER NOT FOUND:", email);
            return res.json({ error: true });
        }

        console.log("✅ RETURNING IMAGE PATH:", rows[0].image_path);  // 🔥 DEBUG
        console.log("✅ STORED POINTS:", rows[0].points);  // 🔥 DEBUG

        res.json({
            image: rows[0].image_path,
            points: rows[0].points
        });

    } catch (err) {
        console.error("❌ GET IMAGE ERROR:", err.message);
        res.json({ error: true });
    }
});

/* =====================================================
   RESET PASSWORD (UPDATE CLICK POINTS)
===================================================== */
app.post("/reset-password", async (req, res) => {

    try {
        const { email, points } = req.body;

        if (!email || !points) {
            return res.json({ success: false });
        }

        await db.execute(
            "UPDATE users SET points=? WHERE email=?",
            [JSON.stringify(points), email]
        );

        res.json({ success: true });

    } catch (err) {
        console.error("RESET ERROR:", err.message);
        res.json({ success: false });
    }
});

/* UPDATE IMAGE + PASSWORD */
console.log("🔥 UPDATE ROUTE REGISTERED");
app.post("/update-image-password", upload.single("image"), async (req, res) => {

    try {
        const { email, points } = req.body;

        console.log("🔥 UPDATE IMAGE REQUEST:", { email, points, file: req.file?.filename });  // 🔥 DEBUG

        if (!email || !points || !req.file) {
            console.log("❌ MISSING DATA:", { email, points, file: !!req.file });
            return res.json({ success: false });
        }

        // 🔥 GET OLD IMAGE
        const [rows] = await db.execute(
            "SELECT image_path FROM users WHERE email=?",
            [email]
        );

        console.log("🔥 OLD IMAGE PATH:", rows[0]?.image_path);  // 🔥 DEBUG

        if (rows.length) {
            const oldPath = String(rows[0].image_path || "").replace(/\\/g, "/").replace(/^\/+/, "");
            let fullOldPath = oldPath;

            if (!path.isAbsolute(fullOldPath)) {
                fullOldPath = path.join(__dirname, fullOldPath);
            }

            fullOldPath = path.normalize(fullOldPath);

            // DELETE OLD IMAGE
            if (fs.existsSync(fullOldPath)) {
                fs.unlinkSync(fullOldPath);
                console.log("✅ OLD IMAGE DELETED:", fullOldPath);  // 🔥 DEBUG
            } else {
                console.log("❌ OLD IMAGE NOT FOUND:", fullOldPath);  // 🔥 DEBUG
            }
        }

        // NEW IMAGE PATH
        const newPath = req.file.path.replace(/\\/g, "/");

        let parsedPoints = points;
        if (typeof parsedPoints === "string") {
            try {
                parsedPoints = JSON.parse(parsedPoints);
            } catch (parseErr) {
                parsedPoints = null;
            }
        }

        if (!Array.isArray(parsedPoints)) {
            console.log("❌ INVALID POINTS:", points);
            return res.json({ success: false, error: "Invalid points" });
        }

        const pointsJson = JSON.stringify(parsedPoints);

        console.log("🔥 NEW IMAGE PATH:", newPath);  // 🔥 DEBUG
        console.log("🔥 POINTS:", pointsJson);  // 🔥 DEBUG

        // UPDATE DB
        await db.execute(
            "UPDATE users SET image_path=?, points=? WHERE email= ?",
            [newPath, pointsJson, email]
        );

        console.log("✅ DATABASE UPDATED SUCCESSFULLY");  // 🔥 DEBUG

        res.json({ success: true });

    } catch (err) {
        console.error("❌ UPDATE IMAGE ERROR:", err.message);
        res.json({ success: false, error: err.message });
    }
});

/* FILE UPLOAD */
app.post("/upload-file", upload.single("file"), async (req,res)=>{

  try {
    const username = req.body.username;
    const filePath = "uploads/" + req.file.filename;

    await db.execute(
      "INSERT INTO files (username,file_path) VALUES (?,?)",
      [username, filePath]
    );

    logAction(req, username, "Uploaded File", path.basename(filePath));
    res.json({success:true});
  } catch (err) {
    console.error("UPLOAD ERROR:", err.message);
    res.status(500).json({success:false});
  }
});


/* GET FILES */
app.get("/get-files", async (req,res)=>{

  const username = req.query.username;

  const [rows] = await db.execute(
    "SELECT file_path FROM files WHERE username=?",
    [username]
  );

  const files = [];

  for(const row of rows){
    let rawPath = String(row.file_path || "");
    let normalizedPath = rawPath.replace(/\\/g, "/");

    if (!normalizedPath.startsWith("uploads/")) {
      // old full path, make relative
      normalizedPath = path.relative(__dirname, normalizedPath).replace(/\\/g, "/");
    }

    if(fs.existsSync(path.join(__dirname, normalizedPath))){
      files.push(normalizedPath);
    } else {
      await db.execute(
        "DELETE FROM files WHERE file_path=? OR file_path=?",
        [rawPath, normalizedPath]
      );
    }
  }

  res.json({ files });
});

/* DELETE FILE */
app.post("/delete-file", async (req,res)=>{

  try{
    const {path: filePath} = req.body;
    const normalizedPath = String(filePath || "").replace(/^\/+/, "").replace(/\\/g, "/");
    const altPath = normalizedPath.replace(/\//g, "\\");
    const localPath = path.join(__dirname, normalizedPath);
    const uploadsRoot = path.join(__dirname, "uploads");

    if (!localPath.startsWith(uploadsRoot)) {
      return res.status(400).json({success:false, error: "Invalid file path"});
    }

    if(!fs.existsSync(localPath)){
      return res.status(404).json({success:false, error: "File not found on disk"});
    }

    console.log("Deleting file from disk:", localPath);
    fs.unlinkSync(localPath);

    if (fs.existsSync(localPath)) {
      return res.status(500).json({success:false, error: "Failed to delete file from disk"});
    }

    await db.execute(
      "DELETE FROM files WHERE file_path=? OR file_path=?",
      [normalizedPath, altPath]
    );

    logAction(req, req.body?.username || "unknown", "Deleted File", path.basename(normalizedPath));

    res.json({success:true});

  }catch(err){
    console.error("DELETE ERROR:", err);
    res.json({success:false, error: err.message});
  }

});

async function cleanupUploads() {
  const [userImgs] = await db.execute("SELECT image_path FROM users");
  const [files] = await db.execute("SELECT file_path FROM files");

  const used = new Set();
  const collectPath = (value) => {
    const normalized = String(value || "").replace(/\\/g, "/").trim();
    if (!normalized) return;
    used.add(normalized);
    used.add(path.basename(normalized));
    if (!normalized.startsWith("uploads/")) {
      used.add(`uploads/${path.basename(normalized)}`);
    }
  };
  userImgs.forEach((u) => collectPath(u.image_path));
  files.forEach((f) => collectPath(f.file_path));

  const uploadsDir = path.join(__dirname, "uploads");
  if (!fs.existsSync(uploadsDir)) {
    return [];
  }

  const allFiles = fs.readdirSync(uploadsDir);
  const deleted = [];

  for (const file of allFiles) {
    const rel = `uploads/${file}`;
    if (!used.has(rel) && !used.has(file)) {
      const fullPath = path.join(uploadsDir, file);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.log("🧹 Deleted:", file);
        deleted.push(file);
      }
    }
  }

  return deleted;
}

/* CLEANUP UNUSED UPLOADS */
app.post("/cleanup-uploads", async (req, res) => {
  try {
    const deleted = await cleanupUploads();
    res.json({ success: true, deletedCount: deleted.length, deleted });
  } catch (err) {
    console.error("CLEANUP ERROR:", err);
    res.status(500).json({ success: false, deletedCount: 0, deleted: [] });
  }
});

/* ALL USERS */
app.get("/all-users", async (req,res)=>{

  const username = req.query.username;

  const [user] = await db.execute(
    "SELECT role FROM users WHERE username=?",
    [username]
  );

  if(!user.length || user[0].role !== "admin"){
    return res.status(403).json({error:"Access denied ❌"});
  }

  const [rows] = await db.execute("SELECT username, role FROM users");

  res.json({users:rows});
});


/* DELETE USER */
app.post("/delete-user", async (req,res)=>{

  const {username, admin} = req.body;

  const [user] = await db.execute(
    "SELECT role FROM users WHERE username=?",
    [admin]
  );

  if(!user.length || user[0].role !== "admin"){
    return res.status(403).json({success:false});
  }

  await db.execute("DELETE FROM users WHERE username=?",[username]);
  logAction(req, admin, "Deleted User", username);

  res.json({success:true});
});

/* MAKE ADMIN */
app.post("/make-admin", async (req,res)=>{

  const {username, admin} = req.body;

  const [user] = await db.execute(
    "SELECT role FROM users WHERE username=?",
    [admin]
  );

  if(!user.length || user[0].role !== "admin"){
    return res.status(403).json({success:false});
  }

  await db.execute(
    "UPDATE users SET role='admin' WHERE username=?",
    [username]
  );
  logAction(req, admin, "Promoted User", username);

  res.json({success:true});
});

/* ADMIN STATS (REAL ANALYTICS) */
app.get("/admin-stats", async (req, res) => {
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

app.get("/audit-logs", async (req, res) => {
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

cleanupUploads()
  .then((deleted) => {
    console.log(`🧹 Startup cleanup completed (${deleted.length} files removed)`);
  })
  .catch((err) => {
    console.error("STARTUP CLEANUP ERROR:", err.message);
  });

setInterval(async () => {
  try {
    console.log("🕒 Running auto cleanup...");
    const deleted = await cleanupUploads();
    console.log(`🧹 Auto cleanup completed (${deleted.length} files removed)`);
  } catch (err) {
    console.error("AUTO CLEANUP ERROR:", err.message);
  }
}, 60 * 60 * 1000);
