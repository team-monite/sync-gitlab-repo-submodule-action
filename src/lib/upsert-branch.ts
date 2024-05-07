import { Gitlab } from '@gitbeaker/rest';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import chalk from 'chalk';
import { TempDir } from './temp-dir.js';
import { BaseCommandOptions } from './types.js';

export interface UpsertBranchOptions extends BaseCommandOptions {
  /** Branch name in the GiLab repository to create the MR from */
  gitlabSourceBranch: string;
}

/**
 * Creates a new branch in the GitLab repository, or updates an existing one
 *
 * @param gitlabProjectId GitLab project ID, e.g. `123` or `group/project`
 * @param gitlabTargetBranch Target branch name in GitLab to merge the MR into
 * @param githubRepositoryBranch Branch name in the GitHub repository which is used as a submodule
 * @param githubRepositorySHA SHA of the last branch commit to be used in the submodule update task
 * @param githubProjectSubmoduleName Submodule name in the GitLab project, e.g. `my-sdk`
 * @param gitlabSourceBranch Source branch name in GitLab to create the MR from
 * @param gitlabOptions GitLab options to authenticate and connect to the API
 * @param commitMessageSalt Salt to identify the commits related to the submodule sync
 */
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

/**
 * Clones the GitLab repository to the temporary directory
 *
 * @param repoBaseDir Base directory to clone the repository into
 * @param gitlabProjectId GitLab project ID, e.g. `123` or `group/project`
 * @param gitlabOptions GitLab options to authenticate and connect to the API
 */
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

/**
 * "Git Checkout" the branch related to the GitHub repository branch
 * @param repoBaseDir Base directory of the Git repository
 * @param githubRepositoryBranch Branch name in the GitHub repository which is used as a submodule
 * @param gitlabTargetBranch Target branch name in GitLab to merge the MR into
 * @param gitlabSourceBranch Source branch name in GitLab to create the MR from
 */
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

/**
 * Validates if the GitLab branch related to the GitHub repository branch is in sync with the submodule
 *
 * @param repoBaseDir Base directory of the Git repository
 * @param gitlabTargetBranch Target branch name in GitLab to merge the MR into
 * @param githubRepositoryBranch Branch name in the GitHub repository which is used as a submodule
 * @param gitlabSourceBranch Source branch name in GitLab to create the MR from
 * @param commitMessageSalt Salt to identify the commits related to the submodule sync
 */
async function validateIsSubmoduleSyncBranch({
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
    .log<{ message: string } | string>({
      from: `origin/${gitlabTargetBranch}`,
      to: gitlabSourceBranch,
      format: '%s',
    })
    .catch(() => {
      // suppress Git errors as they could contain sensitive data
      throw new Error('✖︎ Failed to get log from Git');
    });

  if (
    log.all.some((logItem) => {
      const logComment =
        typeof logItem === 'string' ? logItem : logItem.message;
      if (typeof logComment !== 'string')
        throw new Error('Invalid log comment');
      const hasAutoSyncCommitMessageSalt = new RegExp(
        `\\b${commitMessageSalt}\\b`
      ).test(logComment);
      return !hasAutoSyncCommitMessageSalt;
    })
  ) {
    console.error(
      chalk.red(
        [
          `✖︎ Branch from origin related to the GitHub repository branch "${githubRepositoryBranch} has commits without '${commitMessageSalt}' in the commit message`,
          `Therefore, the script cannot proceed with the sync process.`,
          `🤔 The way to resolve this issue are:`,
          `Delete the origin branch related to the GitHub repository branch "${githubRepositoryBranch}" and run the Job again.`,
        ].join('\n')
      )
    );

    throw new Error(
      `Branch from origin related to the GitHub repository branch "${githubRepositoryBranch} has commits without '${commitMessageSalt}' in the commit message`
    );
  }
}

/**
 * Resets the GitLab branch related to the GitHub repository branch to the state
 * of the target branch (e.g. `main` in GitLab)
 *
 * @param repoBaseDir
 * @param gitlabTargetBranch
 * @param githubRepositoryBranch
 * @param gitlabSourceBranch
 * @param commitMessageSalt
 */
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

/**
 * Gets the submodule path from submodule name
 *
 * @param repoBaseDir Base directory of the Git repository
 * @param githubProjectSubmoduleName Submodule name in the GitLab project, e.g. `my-sdk`
 */
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

/**
 * Gets the latest commit SHA of the branch from the submodule
 *
 * @param baseDir Base directory of the Git repository
 * @param branch Branch name in the submodule
 */
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

/**
 * "Git Checkout" the submodule branch
 *
 * @param repoBaseDir Base directory of the Git repository
 * @param githubProjectSubmoduleName Submodule name in the GitLab project, e.g. `my-sdk`
 * @param githubRepositoryBranch Branch name in the GitHub repository which is used as a submodule
 * @param githubRepositorySHA SHA of the last branch commit to be used in the submodule update task
 */
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

/**
 * Commits the changes in the GitLab repository related to the GitHub repository branch
 *
 * @param repoBaseDir Base directory of the Git repository
 * @param githubProjectSubmoduleName Submodule name in the GitLab project, e.g. `my-sdk`
 * @param githubRepositoryBranch Branch name in the GitHub repository which is used as a submodule
 * @param commitMessageSalt Salt to identify the commits related to the submodule sync
 */
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

/**
 * Pushes the changes in the GitLab repository related to the GitHub repository branch
 *
 * @param repoBaseDir Base directory of the Git repository
 * @param githubRepositoryBranch Branch name in the GitHub repository which is used as a submodule
 * @param gitlabSourceBranch Source branch name in GitLab to create the MR from
 */
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

/**
 * Creates the "source branch" for the GitLab MR
 *
 * @param githubProjectSubmoduleName
 * @param githubRepositoryBranch
 */
export function createMRSourceBranchName({
  githubProjectSubmoduleName,
  githubRepositoryBranch,
}: Pick<
  UpsertBranchOptions,
  'githubProjectSubmoduleName' | 'githubRepositoryBranch'
>) {
  return `${githubProjectSubmoduleName}/${githubRepositoryBranch}`;
}
