import mongoose from "mongoose";
import { env } from "./config.js";

/** Connect mongoose to this service's own database (database-per-service). */
export async function connectMongo(dbName: string): Promise<void> {
  const baseUri = env("MONGODB_URI", "mongodb://localhost:27017");
  const uri = `${baseUri.replace(/\/$/, "")}/${dbName}`;
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log(`[mongo] connected: ${uri}`);
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

export function mongoReady(): boolean {
  return mongoose.connection.readyState === 1;
}
