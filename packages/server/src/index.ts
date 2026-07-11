import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`AutomationSolver API listening on ${config.serverOrigin} (port ${config.port})`);
  if (!config.google.enabled) console.log('  Google OAuth: disabled (set GOOGLE_CLIENT_ID/SECRET)');
  if (!config.github.enabled) console.log('  GitHub OAuth: disabled (set GITHUB_CLIENT_ID/SECRET)');
});
