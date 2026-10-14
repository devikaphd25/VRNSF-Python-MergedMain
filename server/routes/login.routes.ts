/**
 * Legacy username/password login endpoint retained for the optional HTML login.
 * The immersive headset workflow uses device identity and Supabase-backed users
 * through the main server API instead.
 */
import express from "express";
import { supabaseAdmin } from "../services/supabase-admin.service.js";
import {
  getAppUserByUsername,
  getAppUserByDeviceId,
  upsertDeviceAppUser,
} from "../services/app-data.repository.js";
import type { UserRole } from "../types.js";

const router = express.Router();

// Read-only resume: a saved name/role is not enough. Match the permanent
// device user, the student's participant record, and an active classroom.
// Instructor sessions deliberately keep the existing PIN login flow.
router.post("/device-session", async (req, res) => {
  const deviceId = String(req.body?.deviceId ?? "").trim();
  const userId = Number(req.body?.userId);
  const roomId = String(req.body?.roomId ?? "").trim();
  const participantId = String(req.body?.participantId ?? "").trim();
  if (!deviceId || !Number.isInteger(userId) || userId <= 0 || !roomId || !participantId) {
    return res.status(400).json({ success: false, message: "Invalid device session." });
  }

  const user = getAppUserByDeviceId(deviceId);
  if (!user || user.id !== userId || user.role !== "student") {
    return res.status(401).json({ success: false, message: "Please join the classroom again." });
  }

  try {
    const [roomResult, participantResult] = await Promise.all([
      supabaseAdmin.from("rooms").select("id,current_slide")
        .eq("id", roomId).eq("is_active", true).maybeSingle(),
      supabaseAdmin.from("participants").select("id,seat")
        .eq("id", participantId).eq("room_id", roomId)
        .eq("device_id", deviceId).eq("user_id", userId)
        .eq("role", "student").maybeSingle(),
    ]);
    if (roomResult.error || participantResult.error) {
      return res.status(503).json({ success: false, message: "Could not check the classroom session." });
    }
    if (!roomResult.data || !participantResult.data) {
      return res.status(401).json({ success: false, message: "Please join the classroom again." });
    }
    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        seat: participantResult.data.seat,
      },
      session: { roomId, participantId, currentSlide: roomResult.data.current_slide },
    });
  } catch {
    return res.status(503).json({ success: false, message: "Could not check the classroom session." });
  }
});

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

    // A participant represents this permanent user inside a particular room.
    // The join-room RPC already stored the same device ID, so all matching
    // participant rows can now point to the permanent app_users record.
    const { error: participantError } = await supabaseAdmin
      .from("participants")
      .update({ user_id: user.id })
      .eq("device_id", deviceId);

    if (participantError) {
      console.error(
        "[Device Login] Participant link failed:",
        participantError.message
      );
      return res.status(503).json({
        success: false,
        message: "Classroom participant could not be linked.",
      });
    }

    return res.json({ success: true, user });
  } catch (error) {
    console.error("[Device Login] Server error:", error);
    return res.status(500).json({ success: false, message: "Device login failed." });
  }
});

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

    const user = getAppUserByUsername(username);

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
