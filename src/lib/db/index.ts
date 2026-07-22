import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://drill:drill@localhost:5433/drill";

const client = postgres(connectionString, { max: 5 });

export const db = drizzle(client, { schema });
