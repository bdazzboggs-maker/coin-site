// Infrastructure config (env only). Coin branding lives in src/settings.js and is editable in the admin page.
import 'dotenv/config';

const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
const env = (k, d = '') => (process.env[k] === undefined || process.env[k].trim() === '' ? d : process.env[k].trim());

const DEMO = bool(process.env.DEMO, false);

export const config = {
  DEMO,
  RPC_URL: env('RPC_URL', 'https://api.mainnet-beta.solana.com'),
  ADMIN_TOKEN: env('ADMIN_TOKEN', DEMO ? 'demo-admin' : ''),
  PORT: num(process.env.PORT, 3000),
  // Public base URL for share links / link previews; falls back to the request host.
  PUBLIC_URL: env('PUBLIC_URL', '').replace(/\/+$/, ''),
  // Demo mode always uses its own files so sample data never mixes with real records.
  DB_PATH: DEMO ? env('DEMO_DB_PATH', './data/demo.sqlite') : env('DB_PATH', './data/tracker.sqlite'),
  UPLOAD_DIR: DEMO ? env('DEMO_UPLOAD_DIR', './data/demo-uploads') : env('UPLOAD_DIR', './data/uploads'),
  MAX_UPLOAD_BYTES: num(process.env.MAX_UPLOAD_MB, 5) * 1024 * 1024,
  MAX_PENDING_DESIGNS: num(process.env.MAX_PENDING_DESIGNS, 300),
  MESSAGE_MAX_AGE_MS: 10 * 60 * 1000,
};
