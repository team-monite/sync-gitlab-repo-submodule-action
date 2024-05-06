# Sync GitLab Repo Submodule Action

This GitHub action is designed for synchronizing a GitHub repository as a submodule within a GitLab repository. It's particularly useful for keeping GitLab submodules up-to-date with their GitHub counterparts.

The action consists of two main functionalities:

- Syncing a branch from GitHub to GitLab.
- Merging an MR related to the updated branch in GitLab.

### Common Inputs

The action can be configured with the following inputs:

- `action`: **Required.** The action to perform. Possible values are `sync-branch` and `merge-mr`.
- `gitlab_token`: **Required.** Personal Access Token for the GitLab repository.
- `gitlab_host`: **Required.** The host of the GitLab repository. Example: `https://gitlab.com`.
- `gitlab_project_id`: **Required.** The ID of the GitLab project.
- `gitlab_target_branch`: **Required.** The target branch in the GitLab repository for which MRs are created. Example: `main`.
- `submodule_name`: **Required.** The name of the submodule in GitLab. This submodule must be the same repository as the GitHub repository. Example: `my-submodule`.
- `branch`: The branch to sync from GitHub repository to sync with GitLab.
- `sha`: GitHub branch's latest SHA commit for synchronization with GitLab.

### Sync GitHub branch with GitLab MR

Specific inputs for syncing a branch on a pull request:

- `github_pr_url`: The URL of the GitHub pull request. It will be used for the MR description in GitLab.

##### Syncing branch on Pull Request

```yaml
name: Sync GitLab Submodule on Pull Request

on:
  pull_request:
    types:
      - closed
    branches:
      - main

jobs:
  sync-pr-with-gitlab:
    name: Sync PR
    environment: gitlab
    runs-on: ubuntu-latest
    steps:
      - name: Sync PR with GitLab
        uses: team-monite/sync-gitlab-repo-submodule-action@v1
        with:
          action: sync-branch
          gitlab_token: ${{ secrets.GITLAB_TOKEN }}
          gitlab_host: ${{ secrets.GITLAB_HOST }}
          gitlab_project_id: ${{ secrets.GITLAB_PROJECT_ID }}
          gitlab_target_branch: ${{ secrets.GITLAB_TARGET_BRANCH }}
          submodule_name: ${{ secrets.GITLAB_SUBMODULE_NAME }}
          branch: ${{ github.event.pull_request.head.ref }}
          sha: ${{ github.event.pull_request.head.sha }}
          github_pr_url: '${{ github.server_url }}/${{ github.repository }}/pull/${{ github.event.pull_request.number }}' # Optional
```

### Merge GitLab MR related to GitHub branch


#### Merge MR on Pull Request Close

Specific inputs for syncing a branch on push:
- `gitlab_merge_when_pipeline_succeeds`: Optional. If set to `true`, the MR will be merged when the pipeline succeeds.

```yaml
name: Merge GitLab MR related to GitHub branch

on:
  pull_request:
    types:
      - closed
    branches:
      - main

jobs:
  sync:
    name: Merge GitLab MR
    runs-on: ubuntu-latest
    # Ignore specific branches, for example, 'changeset-release/*' branches
    if: ${{ github.event.pull_request.base.ref == 'main' && startsWith(github.event.pull_request.head.ref, 'changeset-release/') == false }}
    steps:
      - name: Merge GitLab MR
        uses: team-monite/sync-gitlab-repo-submodule-action@v1
        with:
          action: merge-mr
          gitlab_token: ${{ secrets.GITLAB_TOKEN }}
          gitlab_host: ${{ secrets.GITLAB_HOST }}
          gitlab_project_id: ${{ secrets.GITLAB_PROJECT_ID }}
          gitlab_target_branch: ${{ secrets.GITLAB_TARGET_BRANCH }}
          submodule_name: ${{ secrets.GITLAB_SUBMODULE_NAME }}
          branch: ${{ github.event.pull_request.head.ref }} # The branch, that was merged
          sha: ${{ github.event.pull_request.head.sha }} # The SHA of the merged branch ^HEAD
          gitlab_merge_when_pipeline_succeeds: 'false' # Optional, useful for merge requests with pipelines
```

## CLI

### Setup

```bash
yarn install
yarn build
```

### Usage

```text
$ yarn sync-gitlab-repo-submodule-action [options] [command]

Options:
  -h, --help             display help for command

Commands:
  sync-branch [options]
  merge-mr [options]
  help [command]         display help for command
```

### Examples

#### Sync Branch

Create a GitLab MR for the GitHub branch `feature/test-01` with the SHA `cc8081627592e2400a5a7c8429366ae0fd636480` in the GitLab repository `my-team/my-repo` with the submodule `my-submodule`.

```bash
yarn sync-gitlab-repo-submodule-action sync-branch -p "my-team/my-repo" -b "feature/test-01" \
  --gitlab-target-branch "master" --sha cc8081627592e2400a5a7c8429366ae0fd636480 --submodule-name my-submodule
```

#### Merge MR

Merge the GitLab MR for the GitHub branch `feature/test-01` with the SHA `cc8081627592e2400a5a7c8429366ae0fd636480` in the GitLab repository `my-team/my-repo` with the submodule `monite-sdk`.

```bash
yarn sync-gitlab-repo-submodule-action merge-mr -p "my-team/my-repo" -b "feature/test-01" \
  --gitlab-target-branch "master" --sha cc8081627592e2400a5a7c8429366ae0fd636480 --submodule-name monite-sdk
```
