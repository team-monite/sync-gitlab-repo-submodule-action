import { GitbeakerRequestError } from '@gitbeaker/requester-utils';

import chalk from 'chalk';
import { Command, program } from 'commander';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', override: false });
dotenv.config({ path: '.env', override: false });

if (!process.env.GITLAB_TOKEN) {
  console.error(chalk.red('`GITLAB_TOKEN` environment variable is required'));
  console.error(chalk.gray('You can add it to a `.env.local` file'));
  process.exit(1);
}

if (!process.env.GITLAB_HOST) {
  console.error(chalk.yellow('`GITLAB_HOST` environment variable is not set'));
  process.exit(1);
}

const gitlabToken = process.env.GITLAB_TOKEN;
const gitlabHost = process.env.GITLAB_HOST;

const commandWithOptions = () =>
  new Command()
    .requiredOption(
      '-p, --gitlab-project-id <project-id>',
      'GitLab Project ID. Example: `123`'
    )
    .requiredOption(
      '-b, --branch <branch>',
      'Branch name, used to create a branch in GitLab'
    )

    .requiredOption(
      '--gitlab-target-branch <branch-name>',
      'Target branch name in GitLab to merge the MR'
    )
    .requiredOption(
      '-m, --submodule-name <submodule-name>',
      'Branch name, used to create a branch in GitLab'
    );

program
  .addCommand(
    commandWithOptions()
      .name('sync-branch')

      .option(
        '-s --sha <sha>',
        'SHA of the commit to be used in the submodule update job. If not provided, the latest commit in the --branch will be used.'
      )
      .action(async (args) => {
        const { syncBranch } = await import('./commands/sync-branch.js');

        try {
          await syncBranch({
            gitlabProjectId: args.gitlabProjectId,
            gitlabTargetBranch: args.gitlabTargetBranch,
            githubRepositoryBranch: args.branch,
            githubRepositorySHA: args.sha,
            githubProjectSubmoduleName: args.submoduleName,
            gitlabOptions: {
              host: gitlabHost,
              token: gitlabToken,
            },
          });
        } catch (error) {
          logError(error);
          process.exit(1);
        }
      })
  )
  .addCommand(
    commandWithOptions()
      .name('merge-mr')
      .requiredOption(
        '-s --sha <sha>',
        'SHA of the commit to be used in the submodule update job. If not provided, the latest commit in the --branch will be used.'
      )
      .action(async (args) => {
        const { mergeMr } = await import('./commands/merge-mr.js');

        try {
          await mergeMr({
            gitlabProjectId: args.gitlabProjectId,
            gitlabTargetBranch: args.gitlabTargetBranch,
            githubRepositoryBranch: args.branch,
            githubRepositorySHA: args.sha,
            githubProjectSubmoduleName: args.submoduleName,
            gitlabOptions: {
              host: gitlabHost,
              token: gitlabToken,
            },
          });
        } catch (error) {
          logError(error);
          process.exit(1);
        }
      })
  );

function logError(error: unknown) {
  if (error instanceof GitbeakerRequestError) {
    console.error(chalk.red('Gitbeaker Request Error'));
    console.error(chalk.red(JSON.stringify(error.cause?.description)));
  } else {
    console.error(error instanceof Error ? chalk.red(error.message) : error);
  }
}

export { program };
