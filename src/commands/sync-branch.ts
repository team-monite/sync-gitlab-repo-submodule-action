import { Gitlab } from '@gitbeaker/rest';

import chalk from 'chalk';

import {
  createMRSourceBranchName,
  upsertBranch,
} from '../lib/upsert-branch.js';
import { BaseCommandOptions } from '../lib/types.js';
import { EditMergeRequestOptions } from '@gitbeaker/core';

/**
 * Creates a new GitLab Merge Request for the branch related to the GitHub repository
 *
 * @param gitlabProjectId GitLab project ID, e.g. `123` or `group/project`
 * @param gitlabTargetBranch Target branch name in GitLab to merge the MR into
 * @param githubRepositoryBranch Branch name in the GitHub repository which is used as a submodule
 * @param githubRepositorySHA SHA of the last branch commit to be used in the submodule update task
 * @param githubProjectSubmoduleName Submodule name in the GitLab project, e.g. `my-sdk`
 * @param gitlabOptions GitLab options to authenticate and connect to the API
 */
export async function syncBranch({
  gitlabProjectId,
  gitlabTargetBranch,
  githubRepositoryBranch,
  githubRepositorySHA,
  githubProjectSubmoduleName,
  gitlabOptions,
}: BaseCommandOptions) {
  const gitlabSourceBranch = createMRSourceBranchName({
    githubProjectSubmoduleName,
    githubRepositoryBranch,
  });

  await upsertBranch({
    gitlabProjectId,
    gitlabTargetBranch,
    githubRepositoryBranch,
    githubRepositorySHA,
    githubProjectSubmoduleName,
    gitlabOptions,
    gitlabSourceBranch,
  });

  const gitlab = new Gitlab(gitlabOptions);

  console.log(
    chalk.gray(
      `🔍 Checking if Merge Request already exists for branch related to "${githubRepositoryBranch}" and target branch "${gitlabTargetBranch}...`
    )
  );
  const [existingMr, ...mrsRest] = await gitlab.MergeRequests.all({
    projectId: gitlabProjectId,
    targetBranch: gitlabTargetBranch,
    sourceBranch: gitlabSourceBranch,
    state: 'opened',
  });

  if (mrsRest.length) {
    throw new Error(
      `✖︎ Found more than one MR for branch related to "${githubRepositoryBranch}" and target branch "${gitlabTargetBranch}"`
    );
  }

  const options = {
    removeSourceBranch: true,
    ...createGitlabMergeRequestInfo({
      githubRepositorySHA,
      githubRepositoryBranch,
      githubProjectSubmoduleName,
    }),
  };

  if (existingMr) {
    console.log(
      chalk.green(
        `☑︎ Merge request #${existingMr.iid} found for branch related to "${githubRepositoryBranch}" and target branch "${gitlabTargetBranch}". No need to create a new one.`
      )
    );

    return void (await gitlab.MergeRequests.edit(
      gitlabProjectId,
      existingMr.iid,
      options
    ));
  }

  console.log(
    chalk.gray(
      `⏳︎ Creating Merge Request for branch related to "${githubRepositoryBranch}" and target branch "${gitlabTargetBranch}...`
    )
  );

  const newMr = await gitlab.MergeRequests.create(
    gitlabProjectId,
    gitlabSourceBranch,
    gitlabTargetBranch,
    options.title,
    options
  );

  if (!newMr.iid) {
    throw new Error('✖︎ Merge request not created');
  }

  console.log(
    chalk.green(
      `✔️ Merge request #${newMr.iid} created for branch related to "${githubRepositoryBranch}" and target branch "${gitlabTargetBranch}"`
    )
  );
}

/**
 * Returns the GitHub Pull Request URL from the environment variables
 */
function getGithubPullRequestUrl() {
  try {
    const prUrl =
      process.env.GITHUB_PR_URL &&
      new URL(process.env.GITHUB_PR_URL).toString();
    // Check if the URL is a valid GitHub Pull Request URL, that ends with a number
    if (/\d+$/.test(prUrl ?? '')) return prUrl;
  } catch (error) {
    return undefined;
  }
}

/**
 * Creates the GitLab Merge Request title and description
 *
 * @param githubRepositorySHA SHA of the last branch commit to be used in MR description
 * @param githubRepositoryBranch Branch name in the GitHub repository which is described in the MR title
 * @param githubProjectSubmoduleName Submodule name in the GitLab project, e.g. `my-sdk`
 */
function createGitlabMergeRequestInfo({
  githubRepositorySHA,
  githubRepositoryBranch,
  githubProjectSubmoduleName,
}: Pick<
  BaseCommandOptions,
  | 'githubRepositoryBranch'
  | 'githubRepositorySHA'
  | 'githubProjectSubmoduleName'
>) {
  const githubPullRequestUrl = getGithubPullRequestUrl();
  const submoduleBranchNameMarkdown = githubPullRequestUrl
    ? `[\`${githubRepositoryBranch}\`](${githubPullRequestUrl})`
    : `\`${githubRepositoryBranch}\``;

  const options: Required<
    Pick<EditMergeRequestOptions, 'title' | 'description'>
  > = {
    title: `chore(${githubProjectSubmoduleName}): update submodule to '${githubRepositoryBranch}'`,
    description: `This MR updates the \`${githubProjectSubmoduleName}\` submodule to the SHA commit \`${githubRepositorySHA}\` on the ${submoduleBranchNameMarkdown} branch.`,
  };

  return options;
}
