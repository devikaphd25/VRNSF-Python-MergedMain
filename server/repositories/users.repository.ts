/**
 * Supabase repository for permanent application data.
 *
 * Goal: isolate database reads/writes for device users from the
 * Socket.IO workflow. It converts snake_case database rows into AppUser
 * objects and caches connected user identities. Called primarily by server.ts.
 */
import { supabaseAdmin } from "../database/supabase-client.js";
import type {
  AppUser,
  AppUserRow,
  DeviceUserInput,
  UserLocation
} from "../types.js";

const usersById = new Map<number, AppUser>();
const userIdsByUsername = new Map<string, number>();
const userIdsByDevice = new Map<string, number>();

function toAppUser(row: AppUserRow): AppUser {
  return { id: Number(row.id), username: `device:${row.device_id ?? row.id}`,
    fullName: row.full_name, role: row.role, seat: null, location: "classroom",
    deviceId: row.device_id };
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
    .from("users")
    .select("id,full_name,role,device_id");
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
  const values = { full_name: existing?.fullName ?? displayName, role, device_id: deviceId };
  const query = supabaseAdmin.from("users").upsert(values, { onConflict: "device_id" });
  const { data, error } = await query
    .select("id,full_name,role,device_id")
    .single();
  if (error) throw new Error(`Could not save Supabase user: ${error.message}`);
  const user = cacheUser(data as AppUserRow);
  user.seat = seat;
  return user;
}

export async function updateAppUserLocation(id: number, location: UserLocation): Promise<void> {
  const user = getAppUserById(id);
  if (!user) throw new Error(`Supabase user ${id} was not found.`);
  user.location = location;
  // Location is live socket state; seats belong to participants, not users.

}
