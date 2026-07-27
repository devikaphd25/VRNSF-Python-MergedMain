import express from "express";
import db from "../../database/database.js";

const router = express.Router();

router.post("/login", (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();

    const requestedRole = String(req.body?.role || "").trim();

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Username is required.",
      });
    }

    if (
      requestedRole !== "student" &&
      requestedRole !== "instructor"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid role.",
      });
    }

    const user = db.prepare(`
      SELECT
        id,
        username,
        fullName,
        role,
        seat,
        location
      FROM users
      WHERE LOWER(username)=LOWER(?)
      LIMIT 1
    `).get(username);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: `User "${username}" was not found.`,
      });
    }

    if (user.role !== requestedRole) {
      return res.status(403).json({
        success: false,
        message:
          `"${user.username}" is registered as "${user.role}", not "${requestedRole}".`,
      });
    }

    console.log("[Login] Successful:", {
      id: user.id,
      username: user.username,
      role: user.role,
      seat: user.seat,
    });

    return res.json({
      success: true,
      user,
    });

  } catch (error) {
    console.error("[Login] Server error:", error);

    return res.status(500).json({
      success: false,
      message: "Server login error.",
    });
  }
});

export default router;