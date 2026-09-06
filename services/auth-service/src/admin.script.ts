import { User } from "./user.model.js";

/**
 * Creates the initial admin account from ADMIN_EMAIL + ADMIN_PASSWORD.
 * Runs at service startup; safe to run repeatedly (no-op if the admin
 * already exists). Password change is enforced on first login downstream.
 */
export async function createAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("[admin] ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin bootstrap");
    return;
  }
  if (password.length < 12) {
    console.warn("[admin] ADMIN_PASSWORD shorter than 12 chars — refusing to create admin");
    return;
  }
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.log("[admin] admin user already exists");
    return;
  }
  const username = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  await User.create({
    username,
    email: email.toLowerCase(),
    password,
    role: "admin",
    isActive: true,
    profile: { skills: [] },
  });
  console.log(`[admin] created admin user: ${username}`);
}
