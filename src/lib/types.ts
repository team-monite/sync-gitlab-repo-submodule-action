import type { BaseRequestOptionsWithAccessToken } from '@gitbeaker/requester-utils';

export interface BaseCommandOptions {
  gitlabProjectId: string;
  gitlabTargetBranch: string;
  githubRepositoryBranch: string;
  gitlabOptions: Required<
    Pick<BaseRequestOptionsWithAccessToken<unknown>, 'host' | 'token'>
  >;
  githubProjectSubmoduleName: string;
}

export interface BaseCheckoutBranchOptions extends BaseCommandOptions {
  githubRepositorySHA: string | undefined;
}
