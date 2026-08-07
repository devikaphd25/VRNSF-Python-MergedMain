import type { Socket } from "socket.io";

export type UserRole = "instructor" | "student";
export type UserLocation = "classroom" | "python_lab";
export type LabStatus = "working" | "completed" | "incomplete" | "instructor_return" | "disconnected";

export interface AppUserRow {
  id: number | string;
  username: string;
  password_hash: string | null;
  full_name: string;
  role: UserRole;
  seat: string | null;
  location: UserLocation;
  device_id: string | null;
}

export interface AppUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  seat: string | null;
  location: UserLocation;
  deviceId: string | null;
  passwordHash: string | null;
}

export interface ClassroomStudent {
  id?: string;
  userId?: number;
  name: string;
  username?: string;
  role?: UserRole;
  seat?: string | null;
  roomId?: string | null;
  participantId?: string | null;
  mode?: string;
  location?: string;
  handRaised?: boolean;
  isMuted?: boolean;
  inLab?: boolean;
  labStatus?: string;
  score?: number;
  [key: string]: any;
}

export interface ConnectedUser {
  userId: number;
  username: string;
  classroomSocketId: string | null;
  labSocketId: string | null;
  location: UserLocation;
  [key: string]: any;
}

export interface ReturningStudent {
  userId?: number;
  username?: string;
  seat?: string | null;
  returnReason?: string | null;
  [key: string]: any;
}

export interface RoomRecord {
  id: string;
  code?: string | null;
  is_active: boolean;
  current_slide?: number;
  created_at?: string;
  closed_at?: string | null;
}

export interface QuickChallenge {
  id: string;
  roomId: string;
  question: string;
  options: string[];
  correctIndex: number;
  durationSeconds: number;
  startedAt: number;
  answers: Map<string, unknown>;
  timeout: NodeJS.Timeout | null;
}

export type ClassroomSocket = Socket & {
  isGameClient?: boolean;
  studentId?: number;
  studentName?: string;
  seat?: string | null;
  data: Socket["data"] & {
    userId?: number;
    role?: UserRole;
    roomId?: string;
    participantId?: string;
    clientType?: "classroom" | "lab";
  };
};

export interface LabMistake {
  studentName: string;
  seat: string | null;
  cardId: string;
  question: string;
  selectedType: string;
  correctType: string;
  attempt: number;
  occurredAt: string;
}

export interface LabExerciseUpdate {
  score?: number;
  streak?: number;
  wpm?: number;
  accuracy?: number;
}

export interface GameResultInput {
  userId: number;
  gameName?: string;
  score?: number;
  durationSeconds?: number;
  status: Exclude<LabStatus, "working">;
}

export interface DeviceUserInput {
  deviceId: string;
  displayName: string;
  role: UserRole;
  seat: string | null;
}
