
import dotenv from 'dotenv'
dotenv.config();
import { env } from 'process'
import { Pool } from 'pg'
const { DATABASE_URL } = env;
export const dbPool = new Pool({ connectionString: DATABASE_URL, max: 50, min: 4, idleTimeoutMillis: 1000 });
