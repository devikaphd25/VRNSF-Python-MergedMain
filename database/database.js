import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

const dataDirectory = path.resolve(
    currentDirectory,
    "../data"
);

// Create data folder if it doesn't exist
fs.mkdirSync(dataDirectory, {
    recursive: true,
});

const databasePath = path.join(
    dataDirectory,
    "vr-classroom.db"
);

const db = new Database(databasePath);

// SQLite settings
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/*
---------------------------------------------------------
Remove old tables (development only)
---------------------------------------------------------
*/
db.exec(`
DROP TABLE IF EXISTS students;
`);

/*
---------------------------------------------------------
Users Table
---------------------------------------------------------
*/
db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    username TEXT UNIQUE NOT NULL,

    password TEXT NOT NULL,

    fullName TEXT NOT NULL,

    role TEXT NOT NULL,

    seat TEXT,

    location TEXT DEFAULT 'classroom',

    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,

    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

console.log("✅ Users table ready.");

/*
---------------------------------------------------------
Game Results Table
---------------------------------------------------------
*/
db.exec(`
CREATE TABLE IF NOT EXISTS game_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    userId INTEGER NOT NULL,

    gameName TEXT NOT NULL,

    score INTEGER DEFAULT 0,

    durationSeconds INTEGER DEFAULT 0,

    status TEXT NOT NULL,

    completedAt DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (userId)
        REFERENCES users(id)
        ON DELETE CASCADE
);
`);

console.log("✅ Game Results table ready.");
/*
---------------------------------------------------------
Default Users
---------------------------------------------------------
*/

const insertUser = db.prepare(`
INSERT OR IGNORE INTO users (
    username,
    password,
    fullName,
    role,
    seat,
    location
)
VALUES (?, ?, ?, ?, ?, ?)
`);

// Instructor
insertUser.run(
    "admin",
    "123",
    "Instructor",
    "instructor",
    null,
    "classroom"
);

// Students
insertUser.run(
    "Tina",
    "123",
    "Tina",
    "student",
    "Seat_R1_01",
    "classroom"
);

insertUser.run(
    "Sager",
    "123",
    "Sager",
    "student",
    "Seat_R1_02",
    "classroom"
);

insertUser.run(
    "Devika",
    "123",
    "Devika",
    "student",
    "Seat_R1_03",
    "classroom"
);

insertUser.run(
    "Nyles",
    "123",
    "Nyles",
    "student",
    "Seat_R1_04",
    "classroom"
);

insertUser.run(
    "Ahmed",
    "123",
    "Ahmed",
    "student",
    "Seat_R1_05",
    "classroom"
);

const users = db
  .prepare(`
    SELECT
      id,
      username,
      fullName,
      role,
      seat,
      location
    FROM users
    ORDER BY id
  `)
  .all();

console.table(users);
console.log(
    `[Database] SQLite connected: ${databasePath}`
);



export function findUserByLogin(username, password) {
  return db
    .prepare(`
      SELECT
        id,
        username,
        fullName,
        role,
        seat,
        location
      FROM users
      WHERE username = ?
        AND password = ?
    `)
    .get(username, password);
}

export default db;