import './loadEnv.js';
import { createApp } from './app.js';
import { config } from './config.js';

const app = await createApp();
app.listen(config.port, () => {
  console.log(`AutomationSolver API listening on ${config.serverOrigin} (port ${config.port})`);
  console.log(`  Database: ${config.databaseUrl ? 'Postgres' : 'SQLite'}`);
  if (!config.google.enabled) console.log('  Google OAuth: disabled (set GOOGLE_CLIENT_ID/SECRET)');
  if (!config.github.enabled) console.log('  GitHub OAuth: disabled (set GITHUB_CLIENT_ID/SECRET)');
});
