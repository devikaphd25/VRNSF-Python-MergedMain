/** Start the compiled app without Vite, tsx, or another development process. */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
process.chdir(projectRoot);

try {
  const envFile = path.join(projectRoot, ".env.server");
  // Hosting-platform variables take precedence over optional local settings.
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  process.env.NODE_ENV = "production";
  process.env.SERVE_WEB_APP = "true";

  for (const variable of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
    if (!process.env[variable]) throw new Error(`Set ${variable} in the hosting environment or .env.server.`);
  }
  for (const artifact of ["dist/index.html", "build/server.js"]) {
    if (!existsSync(path.join(projectRoot, artifact))) {
      throw new Error(`Missing ${artifact}. Run npm ci --include=dev and npm run build before npm start.`);
    }
  }

  await import(pathToFileURL(path.join(projectRoot, "build/server.js")).href);
} catch (error) {
  console.error(`[production] ${error instanceof Error ? error.message : "Server startup failed."}`);
  process.exitCode = 1;
}
