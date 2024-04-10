import type { BaseRequestOptionsWithAccessToken } from '@gitbeaker/requester-utils';

export interface BaseCommandOptions {
  /** GitLab project ID, e.g. `123` or `group/project` */
  gitlabProjectId: string;

  /** Target branch name in GitLab to merge the MR into */
  gitlabTargetBranch: string;

  /** Branch name in the GitHub repository which is used as a submodule */
  githubRepositoryBranch: string;

  /** Submodule name in the GitLab project, e.g. `my-sdk` */
  githubProjectSubmoduleName: string;

  /** GitLab options to authenticate and connect to the API */
  gitlabOptions: Required<
    Pick<BaseRequestOptionsWithAccessToken<unknown>, 'host' | 'token'>
  >;

  /** SHA of the last branch commit to be used in the submodule update task */
  githubRepositorySHA: string | undefined;
}
