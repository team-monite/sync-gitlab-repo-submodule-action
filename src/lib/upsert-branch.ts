import { Gitlab } from '@gitbeaker/rest';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import chalk from 'chalk';
import { TempDir } from './temp-dir.js';
import { BaseCheckoutBranchOptions } from './types.js';

export interface UpsertBranchOptions extends BaseCheckoutBranchOptions {
  gitlabSourceBranch: string;
}

export async function upsertBranch(
  {
    gitlabProjectId,
    gitlabTargetBranch,
    githubRepositoryBranch,
    githubRepositorySHA,
    githubProjectSubmoduleName,
    gitlabSourceBranch,
    gitlabOptions,
  }: UpsertBranchOptions,
  commitMessageSalt = 'submodule-auto-sync'
) {
  using repositoryTempDir = new TempDir();

  const repoBaseDir = repositoryTempDir.path;

  await cloneGitlabRepo(repoBaseDir, {
    gitlabProjectId,
    gitlabOptions,
  });

  await checkoutGitlabSourceBranch(repoBaseDir, {
    gitlabTargetBranch,
    githubRepositoryBranch,
    gitlabSourceBranch,
  });

  await resetGitlabRepoBranch({
    repoBaseDir,
    gitlabTargetBranch,
    githubRepositoryBranch,
    gitlabSourceBranch,
    commitMessageSalt,
  });

  await checkoutSubmoduleBranch({
    repoBaseDir,
    githubRepositoryBranch,
    githubRepositorySHA,
    githubProjectSubmoduleName,
  });

  await commitGitlabRepoChanges({
    repoBaseDir,
    githubProjectSubmoduleName,
    githubRepositoryBranch,
    commitMessageSalt,
  });

  await pushGitlabRepoChanges({
    repoBaseDir,
    githubRepositoryBranch,
    gitlabSourceBranch,
  });
}

async function cloneGitlabRepo(
  repoBaseDir: string,
  {
    gitlabProjectId,
    gitlabOptions,
  }: Pick<UpsertBranchOptions, 'gitlabProjectId' | 'gitlabOptions'>
) {
  const gitlab = new Gitlab(gitlabOptions);

  const userData = await gitlab.Users.showCurrentUser().catch((error) => {
    console.error(chalk.red('✖︎ Failed to get user data from GitLab API'));
    throw error;
  });

  console.log(
    chalk.grey(`🔍 Getting project path for project with ID ${gitlabProjectId}`)
  );

  const projectPath = (await gitlab.Projects.show(gitlabProjectId))
    .path_with_namespace;

  console.log(chalk.green(`☑︎ Project path found`));

  const git = simpleGit({
    baseDir: repoBaseDir,
  });

  console.log(
    chalk.grey(`🎋 Cloning GitLab project with ID ${gitlabProjectId}`)
  );

  await git
    .clone(
      `https://${userData.username}:${gitlabOptions.token}@${
        new URL(gitlabOptions.host).host
      }/${projectPath}.git`,
      '.',
      {}
    )
    .catch(() => {
      // suppress Git errors as they could contain sensitive data
      throw new Error('✖︎ Failed to clone GitLab repository');
    });

  await git.addConfig('user.email', userData.email).catch(() => {
    // suppress Git errors as they could contain sensitive data
    throw new Error('✖︎ Failed to set user email in Git config');
  });

  await git.addConfig('user.name', userData.username).catch(() => {
    // suppress Git errors as they could contain sensitive data
    throw new Error('✖︎ Failed to set user name in Git config');
  });
}

async function checkoutGitlabSourceBranch(
  repoBaseDir: string,
  {
    githubRepositoryBranch,
    gitlabTargetBranch,
    gitlabSourceBranch,
  }: Pick<
    UpsertBranchOptions,
    'githubRepositoryBranch' | 'gitlabTargetBranch' | 'gitlabSourceBranch'
  >
) {
  const git = simpleGit({
    baseDir: repoBaseDir,
  });

  await git
    .fetch('origin', gitlabSourceBranch)
    .catch(() => {
      // suppress Git errors as they could contain sensitive data
      throw new Error(
        `✖︎ Failed to fetch branch from origin related to the GitHub repository branch "${githubRepositoryBranch}`
      );
    })
    .then(() =>
      git
        .checkoutBranch(gitlabSourceBranch, `origin/${gitlabSourceBranch}`)
        .catch(() => {
          console.error(
            chalk.yellow(
              `✖︎ Branch related to the GitHub repository branch "${githubRepositoryBranch}" not found in the GitLab repository.`
            )
          );

          // suppress Git errors as they could contain sensitive data
          throw new Error(
            `✖︎ Failed to checkout branch from origin related to the GitHub repository branch "${githubRepositoryBranch}`
          );
        })
    )
    .catch(async () => {
      await git.fetch('origin', gitlabTargetBranch).catch(() => {
        // suppress Git errors as they could contain sensitive data
        throw new Error(
          `✖︎ Failed to fetch ${gitlabTargetBranch} branch from origin`
        );
      });

      return git
        .checkoutBranch(gitlabSourceBranch, `origin/${gitlabTargetBranch}`)
        .catch(() => {
          // suppress Git errors as they could contain sensitive data
          throw new Error(
            `✖︎ Failed to checkout ${gitlabTargetBranch} branch from origin`
          );
        });
    });
}

async function validateIsSubmoduleSyncBranch({
  repoBaseDir,
  commitMessageSalt,
  gitlabTargetBranch,
  githubRepositoryBranch,
  gitlabSourceBranch,
}: {
  repoBaseDir: string;
  commitMessageSalt: string;
} & Pick<
  UpsertBranchOptions,
  'gitlabTargetBranch' | 'githubRepositoryBranch' | 'gitlabSourceBranch'
>): Promise<void> {
  const git = simpleGit({
    baseDir: repoBaseDir,
  });

  await git.fetch('origin', gitlabTargetBranch).catch(() => {
    throw new Error(
      `✖︎ Failed to fetch ${gitlabTargetBranch} branch from origin`
    );
  });

  const log = await git
    .log({
      from: `origin/${gitlabTargetBranch}`,
      to: gitlabSourceBranch,
      format: '%s',
    })
    .catch(() => {
      // suppress Git errors as they could contain sensitive data
      throw new Error('✖︎ Failed to get log from Git');
    });

  if (
    log.all.some((logItem) =>
      new RegExp(`\b${commitMessageSalt}\b`).test(logItem)
    )
  ) {
    console.error(
      chalk.red(
        `✖︎ Branch from origin related to the GitHub repository branch "${githubRepositoryBranch} has commits without '${commitMessageSalt}' in the commit message`,
        `Therefore, the script cannot proceed with the sync process.`,
        `🤔 The way to resolve this issue are:`,
        `Delete the origin branch related to the GitHub repository branch "${githubRepositoryBranch}" and run the Job again.`
      )
    );

    throw new Error(
      `Branch from origin related to the GitHub repository branch "${githubRepositoryBranch} has commits without '${commitMessageSalt}' in the commit message`
    );
  }
}

async function resetGitlabRepoBranch({
  repoBaseDir,
  gitlabTargetBranch,
  githubRepositoryBranch,
  gitlabSourceBranch,
  commitMessageSalt,
}: {
  repoBaseDir: string;
  commitMessageSalt: string;
} & Pick<
  UpsertBranchOptions,
  'gitlabTargetBranch' | 'githubRepositoryBranch' | 'gitlabSourceBranch'
>) {
  await validateIsSubmoduleSyncBranch({
    repoBaseDir,
    gitlabTargetBranch,
    githubRepositoryBranch,
    commitMessageSalt,
    gitlabSourceBranch,
  });

  const git = simpleGit({
    baseDir: repoBaseDir,
  });

  console.log(
    chalk.grey(
      `‼️ Resetting branch related to the GitHub repository branch "${githubRepositoryBranch}" to the state of the branch "${gitlabTargetBranch}"`
    )
  );

  await git
    .reset(['--hard', '--quiet', `origin/${gitlabTargetBranch}`])
    .catch(() => {
      // suppress Git errors as they could contain sensitive data
      throw new Error('✖︎ Failed to reset hard');
    });
}

async function getSubmodulePath({
  repoBaseDir,
  githubProjectSubmoduleName,
}: {
  repoBaseDir: string;
} & Pick<UpsertBranchOptions, 'githubProjectSubmoduleName'>) {
  const git = simpleGit({
    baseDir: repoBaseDir,
  });

  const submodulePath = await git
    .raw([
      'config',
      '--file=.gitmodules',
      `submodule.${githubProjectSubmoduleName}.path`,
    ])
    .catch(() => {
      // suppress Git errors as they could contain sensitive data
      throw new Error('✖︎ Failed to get submodule path');
    })
    .then((res) => res.trim());

  if (!submodulePath) {
    throw new Error('✖︎ Submodule path not found');
  }

  return submodulePath;
}

async function getRepoBranchHeadSHA({
  baseDir,
  branch,
}: {
  baseDir: string;
  branch: string;
}) {
  console.log(chalk.grey('🔍 Submodule SHA is not set, fetching from remote'));

  const git = simpleGit({ baseDir });

  return git
    .listRemote(['--heads', branch])
    .catch(() => {
      // suppress Git errors as they could contain sensitive data
      throw new Error('✖︎ Failed to list submodule remote');
    })
    .then(
      /**
       * @param result Example: `a2f6c4e2a11d0a7b8b994363bc6b8a6db60027f8   refs/heads/my-branch`
       */
      (result) => {
        const [sha] = result.split(/\s+/);
        return sha;
      }
    );
}

async function checkoutSubmoduleBranch({
  repoBaseDir,
  githubProjectSubmoduleName,
  githubRepositoryBranch,
  githubRepositorySHA,
}: { repoBaseDir: string } & Pick<
  UpsertBranchOptions,
  | 'githubProjectSubmoduleName'
  | 'githubRepositoryBranch'
  | 'githubRepositorySHA'
>) {
  const submoduleRelativePath = await getSubmodulePath({
    repoBaseDir,
    githubProjectSubmoduleName,
  });

  const submoduleBaseDir = path.join(repoBaseDir, submoduleRelativePath);

  const submoduleBranchHeadSHA =
    githubRepositorySHA ||
    (await getRepoBranchHeadSHA({
      baseDir: submoduleBaseDir,
      branch: githubRepositoryBranch,
    }));

  console.log(
    chalk.green(`☑︎ SHA for submodule is ${submoduleBranchHeadSHA}`)
  );

  const git = simpleGit({
    baseDir: repoBaseDir,
  });

  console.log(
    chalk.grey(`🔍 Initializing submodule "${githubProjectSubmoduleName}"`)
  );

  await git
    .submoduleUpdate(['--init', githubProjectSubmoduleName])
    .catch(() => {
      // suppress Git errors as they could contain sensitive data
      throw new Error('✖︎ Failed to submodule init');
    });

  const submodule = simpleGit({
    baseDir: submoduleBaseDir,
  });

  console.log(chalk.gray(`🏗️ Updating submodule to ${submoduleBranchHeadSHA}`));

  console.log(
    chalk.grey(
      `🔍 Fetching submodule origin branch "${githubRepositoryBranch}"`
    )
  );

  await submodule.fetch('origin', githubRepositoryBranch).catch(() => {
    // suppress Git errors as they could contain sensitive data
    throw new Error(
      `✖︎ Failed to fetch submodule origin branch "${githubRepositoryBranch}"`
    );
  });

  console.log(
    chalk.grey(`⏳︎ Checking out submodule branch "${githubRepositoryBranch}"`)
  );

  await submodule
    .checkoutBranch(githubRepositoryBranch, `origin/${githubRepositoryBranch}`)
    .catch(() => {
      // suppress Git errors as they could contain sensitive data
      throw new Error(
        `✖︎ Failed to checkout submodule branch "${githubRepositoryBranch}"`
      );
    });

  console.log(
    chalk.grey(`⏳︎ Checking out submodule SHA "${submoduleBranchHeadSHA}"`)
  );

  await submodule.checkout(submoduleBranchHeadSHA).catch(() => {
    // suppress Git errors as they could contain sensitive data
    throw new Error(
      `✖︎ Failed to checkout submodule SHA "${submoduleBranchHeadSHA}"`
    );
  });

  console.log(
    chalk.grey(
      `⏳︎ Validating submodule branch "${githubRepositoryBranch}" HEAD is "${submoduleBranchHeadSHA}"`
    )
  );

  const branchHeadSHA = await submodule.revparse('HEAD').catch(() => {
    // suppress Git errors as they could contain sensitive data
    throw new Error(
      `✖︎ Failed to validate submodule branch "${githubRepositoryBranch}" HEAD is "${submoduleBranchHeadSHA}"`
    );
  });

  if (branchHeadSHA !== submoduleBranchHeadSHA) {
    throw new Error(
      `✖︎ Failed to checkout submodule branch "${githubRepositoryBranch}", submodule current HEAD is "${branchHeadSHA}" instead of "${submoduleBranchHeadSHA}"`
    );
  }
}

async function commitGitlabRepoChanges({
  repoBaseDir,
  githubProjectSubmoduleName,
  githubRepositoryBranch,
  commitMessageSalt,
}: {
  repoBaseDir: string;
  commitMessageSalt: string;
} & Pick<
  UpsertBranchOptions,
  'githubProjectSubmoduleName' | 'githubRepositoryBranch'
>) {
  const git = simpleGit({
    baseDir: repoBaseDir,
  });

  console.log(
    chalk.grey(
      `📦 Committing submodule "${githubProjectSubmoduleName}" to branch related to the GitHub repository branch "${githubRepositoryBranch}"`
    )
  );

  const submodulePath = await getSubmodulePath({
    repoBaseDir,
    githubProjectSubmoduleName,
  });

  await git.add(submodulePath).catch(() => {
    // suppress Git errors as they could contain sensitive data
    throw new Error(
      `✖︎ Failed to add submodule "${githubProjectSubmoduleName}"`
    );
  });

  await git
    .commit(
      `chore: update '${githubProjectSubmoduleName}' submodule to '${githubRepositoryBranch}' \`${commitMessageSalt}\``,
      ['--no-verify']
    )
    .catch(() => {
      // suppress Git errors as they could contain sensitive data
      throw new Error(
        `✖︎ Failed to commit submodule "${githubProjectSubmoduleName}"`
      );
    });
}

async function pushGitlabRepoChanges({
  repoBaseDir,
  githubRepositoryBranch,
  gitlabSourceBranch,
}: {
  repoBaseDir: string;
} & Pick<
  UpsertBranchOptions,
  'githubRepositoryBranch' | 'gitlabSourceBranch'
>) {
  const git = simpleGit({
    baseDir: repoBaseDir,
  });

  console.log(
    chalk.grey(
      `🫸 Pushing changes to branch related to the GitHub repository branch "${githubRepositoryBranch}"`
    )
  );

  await git
    .push('origin', gitlabSourceBranch, ['--force', '--no-verify'])
    .catch(() => {
      // suppress Git errors as they could contain sensitive data
      throw new Error(
        `✖︎ Failed to push to the origin branch related to the GitHub repository branch "${githubRepositoryBranch}"`
      );
    });

  console.log(
    chalk.green(
      `✔️ Changes pushed to the origin branch related to the GitHub repository branch "${githubRepositoryBranch}"`
    )
  );
}

export function getMRSourceBranchName({
  githubProjectSubmoduleName,
  githubRepositoryBranch,
}: Pick<
  UpsertBranchOptions,
  'githubProjectSubmoduleName' | 'githubRepositoryBranch'
>) {
  return `${githubProjectSubmoduleName}/${githubRepositoryBranch}`;
}
