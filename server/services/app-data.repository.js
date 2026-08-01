import { timingSafeEqual, scryptSync } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin.service.js";

const usersById = new Map();
const userIdsByUsername = new Map();
const userIdsByDevice = new Map();

function toAppUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    seat: row.seat,
    location: row.location,
    deviceId: row.device_id,
    passwordHash: row.password_hash,
  };
}

function cacheUser(row) {
  const user = toAppUser(row);
  usersById.set(user.id, user);
  userIdsByUsername.set(user.username.toLowerCase(), user.id);
  if (user.deviceId) userIdsByDevice.set(user.deviceId, user.id);
  return user;
}

export async function initializeAppDataRepository() {
  const { data, error } = await supabaseAdmin
    .from("app_users")
    .select("id,username,password_hash,full_name,role,seat,location,device_id");
  if (error) throw new Error(`Could not load Supabase users: ${error.message}`);

  usersById.clear();
  userIdsByUsername.clear();
  userIdsByDevice.clear();
  for (const row of data ?? []) cacheUser(row);
  return usersById.size;
}

export function getAppUserById(id) {
  return usersById.get(Number(id)) ?? null;
}

export function getAppUserByUsername(username) {
  const id = userIdsByUsername.get(String(username ?? "").trim().toLowerCase());
  return id ? getAppUserById(id) : null;
}

export function getAppUserByDeviceId(deviceId) {
  const id = userIdsByDevice.get(String(deviceId ?? "").trim());
  return id ? getAppUserById(id) : null;
}

export function getAppUserCount() {
  return usersById.size;
}

export async function upsertDeviceAppUser({ deviceId, displayName, role, seat }) {
  const existing = getAppUserByDeviceId(deviceId);
  const values = {
    username: existing?.username ?? `device:${deviceId}`,
    full_name: displayName,
    role,
    seat,
    location: "classroom",
    device_id: deviceId,
    updated_at: new Date().toISOString(),
  };

  const query = existing
    ? supabaseAdmin.from("app_users").update(values).eq("id", existing.id)
    : supabaseAdmin.from("app_users").insert(values);
  const { data, error } = await query
    .select("id,username,password_hash,full_name,role,seat,location,device_id")
    .single();
  if (error) throw new Error(`Could not save Supabase user: ${error.message}`);
  return cacheUser(data);
}

export async function updateAppUserLocation(id, location) {
  const user = getAppUserById(id);
  if (!user) throw new Error(`Supabase user ${id} was not found.`);
  user.location = location;
  const { error } = await supabaseAdmin
    .from("app_users")
    .update({ location, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) throw new Error(`Could not update user location: ${error.message}`);
}

export async function saveAppGameResult({
  userId,
  gameName = "Python Type Lab",
  score = 0,
  durationSeconds = 0,
  status,
}) {
  const { error } = await supabaseAdmin.from("game_results").insert({
    user_id: Number(userId),
    game_name: gameName,
    score: Number(score) || 0,
    duration_seconds: Number(durationSeconds) || 0,
    status,
  });
  if (error) throw new Error(`Could not save game result: ${error.message}`);
}

export function verifyAppPassword(user, password) {
  if (!user?.passwordHash) return false;
  const [algorithm, saltHex, hashHex] = user.passwordHash.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(String(password ?? ""), Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
