import type { PipelineStatus } from '@gitbeaker/core';
import { Gitlab } from '@gitbeaker/rest';

import chalk from 'chalk';
import { BaseCommandOptions } from '../lib/types.js';
import { getMRSourceBranchName } from '../lib/upsert-branch.js';
import { parseBooleanEnvVar } from '../lib/parse-boolean-env-var.js';

interface MergeMROptions extends BaseCommandOptions {
  githubRepositorySHA: string;
}

export async function mergeMr({
  gitlabProjectId,
  gitlabTargetBranch,
  githubRepositoryBranch,
  githubRepositorySHA,
  githubProjectSubmoduleName,
  gitlabOptions,
}: MergeMROptions) {
  const gitlab = new Gitlab(gitlabOptions);
  const gitlabSourceBranch = getMRSourceBranchName({
    githubProjectSubmoduleName,
    githubRepositoryBranch,
  });

  const [mr, ...mrsRest] = await gitlab.MergeRequests.all({
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

  if (!mr) {
    throw new Error(
      `✖︎ Merge request not found for branch related to "${githubRepositoryBranch}" and SHA "${githubRepositorySHA}"`
    );
  }

  console.log(
    chalk.grey(
      `☑︎ Merge request #${mr.iid} found for branch related to "${githubRepositoryBranch}" and target branch "${gitlabTargetBranch}`
    )
  );

  if (mr.has_conflicts) {
    throw new Error(
      `✖︎ Merge request #${mr.iid} has conflicts. Please resolve them before and run the action again`
    );
  }

  console.log(chalk.gray(`- ☑︎ MR has no conflicts`));

  const diffs = await gitlab.MergeRequests.allDiffs(gitlabProjectId, mr.iid);

  const isMRContainsSubmoduleSHA = diffs.some(
    (diff) =>
      diff.new_path === 'monite-sdk' &&
      diff.old_path === 'monite-sdk' &&
      diff.diff.includes(`+Subproject commit ${githubRepositorySHA}\n`)
  );

  if (!isMRContainsSubmoduleSHA) {
    throw new Error(
      `✖︎ Merge request #${mr.iid} does not contain submodule SHA '${githubRepositorySHA}' for the branch '${githubRepositoryBranch}'`
    );
  }

  console.log(
    chalk.gray(`- ☑︎ MR contains submodule SHA '${githubRepositorySHA}'`)
  );

  const result = await gitlab.MergeRequests.merge(gitlabProjectId, mr.iid, {
    mergeWhenPipelineSucceeds: parseBooleanEnvVar(
      process.env.GITLAB_MERGE_WHEN_PIPELINE_SUCCEEDS
    ),
    sha: mr.sha,
    mergeCommitMessage: [
      `Merge branch '${githubRepositoryBranch}' into '${gitlabTargetBranch}' with 'monite-sdk' submodule commit '${githubRepositorySHA}'`,
      '',
      '* This MR was merged automatically by the Monite GitHub Action.',
    ].join('\n'),
  });

  if (result.state === 'merged') {
    return void console.log(
      chalk.green(
        `✔︎ Merge request #${mr.iid} has been successfully merged into the target branch '${gitlabTargetBranch}'`
      )
    );
  }

  const pipelineStatus = result.pipeline?.status as PipelineStatus;

  if (pipelineStatus === 'canceled' || pipelineStatus === 'failed')
    throw new Error(
      `✖︎ Merge request #${mr.iid} has not been merged due to pipeline status '${pipelineStatus}'`
    );

  if (pipelineStatus === 'success') {
    throw new Error(
      `✖︎ Merge request #${mr.iid} has not been merged due to unknown reason`
    );
  }
}
