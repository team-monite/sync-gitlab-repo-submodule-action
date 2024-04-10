import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A temporary directory that is created and deleted, if used with the `using`.
 *
 * @exmaple
 * In this example, we create a temporary directory,
 * and when the parent scope is exited, the directory is deleted,
 * because it implements the `Disposable` es2022 interface.
 *
 * ```ts
 * using myTempDirDescriptor = new TempDir();
 * const myTempDirPath = myTempDirDescriptor.path;
 * ```
 */
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
