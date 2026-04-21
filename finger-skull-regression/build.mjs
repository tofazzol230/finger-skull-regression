import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
await mkdir(dist, { recursive: true });

for (const f of ['index.html', 'app.js', 'style.css']) {
  await copyFile(join(process.cwd(), f), join(dist, f));
}
