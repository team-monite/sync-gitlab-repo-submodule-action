import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

export class TempDir implements Disposable {
  readonly path: string;

  constructor() {
    this.path = path.join(
      process.env.TMP_GITLAB_REPOSITORY_WORKING_DIR ?? os.tmpdir(),
      `gitlab-sync-${Date.now()}`
    );

    fs.mkdirSync(this.path, { recursive: true });

    if (fs.readdirSync(this.path).length > 0) {
      throw new Error(
        `The directory "${this.path}" is not empty. Please provide an empty directory.`
      );
    }
  }

  [Symbol.dispose]() {
    fs.rmSync(this.path, { recursive: true, force: true });
  }
}
