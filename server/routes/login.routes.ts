/** Device registration uses the new users table; classroom membership is
 * created separately in class-sessions.repository.ts. No password login. */
import express from "express";
import {
  upsertDeviceAppUser,
} from "../services/app-data.repository.js";
import type { UserRole } from "../types.js";

const router = express.Router();

router.post("/device-login", async (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || "").trim();
    const role = String(req.body?.role || "").trim();
    const displayName = String(req.body?.displayName || "").trim();
    const seat = req.body?.seat ? String(req.body.seat).trim() : null;

    if (!deviceId || !displayName || !["student", "instructor"].includes(role)) {
      return res.status(400).json({ success: false, message: "Invalid device login." });
    }

    const user = await upsertDeviceAppUser({
      deviceId,
      displayName,
      role: role as UserRole,
      seat,
    });

    return res.json({ success: true, user });
  } catch (error) {
    console.error("[Device Login] Server error:", error);
    return res.status(500).json({ success: false, message: "Device login failed." });
  }
});

export default router;
