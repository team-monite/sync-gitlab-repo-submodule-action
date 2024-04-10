FROM cimg/node:20.12.1
USER root
WORKDIR /app
COPY . /app
RUN yarn install --immutable
RUN yarn run build

WORKDIR /tmp-repository
RUN chown circleci:circleci /tmp-repository

USER circleci
ENV TMP_GITLAB_REPOSITORY_WORKING_DIR=/tmp-repository
ENTRYPOINT ["/app/bin.mjs"]
