import { timingSafeEqual, scryptSync } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin.service.js";
import type {
  AppUser,
  AppUserRow,
  DeviceUserInput,
  GameResultInput,
  UserLocation
} from "../types.js";

const usersById = new Map<number, AppUser>();
const userIdsByUsername = new Map<string, number>();
const userIdsByDevice = new Map<string, number>();

function toAppUser(row: AppUserRow): AppUser {
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

function cacheUser(row: AppUserRow): AppUser {
  const user = toAppUser(row);
  usersById.set(user.id, user);
  userIdsByUsername.set(user.username.toLowerCase(), user.id);
  if (user.deviceId) userIdsByDevice.set(user.deviceId, user.id);
  return user;
}

export async function initializeAppDataRepository(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("app_users")
    .select("id,username,password_hash,full_name,role,seat,location,device_id");
  if (error) throw new Error(`Could not load Supabase users: ${error.message}`);

  usersById.clear();
  userIdsByUsername.clear();
  userIdsByDevice.clear();
  for (const row of data ?? []) cacheUser(row as AppUserRow);
  return usersById.size;
}

export function getAppUserById(id: number): AppUser | null {
  return usersById.get(Number(id)) ?? null;
}

export function getAppUserByUsername(username: string): AppUser | null {
  const id = userIdsByUsername.get(String(username ?? "").trim().toLowerCase());
  return id ? getAppUserById(id) : null;
}

export function getAppUserByDeviceId(deviceId: string): AppUser | null {
  const id = userIdsByDevice.get(String(deviceId ?? "").trim());
  return id ? getAppUserById(id) : null;
}

export function getAppUserCount(): number {
  return usersById.size;
}

export async function upsertDeviceAppUser({ deviceId, displayName, role, seat }: DeviceUserInput): Promise<AppUser> {
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
  return cacheUser(data as AppUserRow);
}

export async function updateAppUserLocation(id: number, location: UserLocation): Promise<void> {
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
}: GameResultInput): Promise<void> {
  const { error } = await supabaseAdmin.from("game_results").insert({
    user_id: Number(userId),
    game_name: gameName,
    score: Number(score) || 0,
    duration_seconds: Number(durationSeconds) || 0,
    status,
  });
  if (error) throw new Error(`Could not save game result: ${error.message}`);
}

export async function getRecentAppGameResults(limit = 50): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseAdmin
    .from("game_results")
    .select(`
      id,
      user_id,
      game_name,
      score,
      duration_seconds,
      status,
      completed_at,
      app_users!game_results_user_id_fkey(full_name,seat)
    `)
    .order("completed_at", { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit) || 50, 200)));

  if (error) throw new Error(`Could not load game results: ${error.message}`);

  const latestByUser = new Map();
  for (const row of data ?? []) {
    const joinedUser = Array.isArray(row.app_users)
      ? row.app_users[0]
      : row.app_users;
    const userId = Number(row.user_id);
    if (latestByUser.has(userId)) continue;
    latestByUser.set(userId, {
      id: Number(row.id),
      userId,
      name: joinedUser?.full_name ?? `Student ${userId}`,
      seat: joinedUser?.seat ?? "Not selected",
      gameName: row.game_name,
      score: Number(row.score) || 0,
      durationSeconds: Number(row.duration_seconds) || 0,
      status: row.status,
      completedAt: row.completed_at,
    });
  }

  return [...latestByUser.values()];
}

export function verifyAppPassword(user: AppUser | null, password: string): boolean {
  if (!user?.passwordHash) return false;
  const [algorithm, saltHex, hashHex] = user.passwordHash.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(String(password ?? ""), Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
