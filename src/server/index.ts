import { fileURLToPath } from 'node:url';
import { createApplication } from './app.ts';
import { defaultDataDirectory } from './store.ts';
import { installedPreparationOptions } from './preidle.ts';

const port = Number(process.env.LRD_PORT ?? 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('LRD_PORT must be an integer from 1024 to 65535');
const application = await createApplication({
  dataDirectory: defaultDataDirectory(),
  clientDirectory: fileURLToPath(new URL('../client/', import.meta.url)),
  development: process.argv.includes('--dev'),
  preparation: installedPreparationOptions({ platform: process.platform, enabledFlag: process.env.LRD_PREVIEW_PREPARER,
    executable: process.execPath, entry: fileURLToPath(import.meta.url), dataDirectory: defaultDataDirectory() }),
});
application.server.on('error', error => { console.error(`Living Room Display could not start: ${error.message}`); process.exitCode = 1; });
application.server.listen(port, '127.0.0.1', () => {
  console.log(`Living Room Display: http://127.0.0.1:${port}`);
  if (application.store.warning) console.warn(application.store.warning);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { application.closePreparation(); application.server.close(); });
