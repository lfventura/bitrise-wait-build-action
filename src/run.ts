import * as core from '@actions/core';
import * as github from '@actions/github';

type CheckRun = {
  name?: string | null;
  external_id?: string | null;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function getPositiveIntInput(name: string): number {
  const raw = core.getInput(name).trim();
  if (!/^\d+$/.test(raw) || parseInt(raw, 10) <= 0) {
    throw new Error(`Input "${name}" must be a positive integer number of seconds, got "${raw}".`);
  }
  return parseInt(raw, 10);
}

export async function run(sleep: (ms: number) => Promise<void> = defaultSleep, now: () => number = Date.now): Promise<void> {
  try {
    const githubToken: string = core.getInput('github_token');
    const bitriseToken: string = core.getInput('bitrise_token');
    const repo: string = core.getInput('repo');
    const owner: string = core.getInput('owner');
    const sha: string = core.getInput('sha');
    const bitriseCheckName: string = core.getInput('bitrise_check_name');
    const bitriseCheckPeriod: number = getPositiveIntInput('bitrise_check_period') * 1000;
    const checkWaitTimeoutSeconds: number = getPositiveIntInput('bitrise_check_wait_timeout');

    const octokit = github.getOctokit(githubToken);

    core.info(`Checking check runs for commit: ${sha}`);

    // Retrieve check runs for the SHA, paging until we find the Bitrise check run.
    // octokit.paginate normalizes the response before handing it to this callback, so
    // `response.data` is already the `check_runs` array rather than the wrapper object.
    const findBitriseCheckRun = async (): Promise<CheckRun | undefined> => {
      const checkRuns = await octokit.paginate(
        octokit.rest.checks.listForRef,
        { owner, repo, ref: sha, per_page: 100 },
        (response, done) => {
          const pageCheckRuns = response.data as CheckRun[];
          const found = pageCheckRuns.find((check: CheckRun) => check.name === bitriseCheckName);
          if (found) done();
          return pageCheckRuns;
        },
      );
      return checkRuns.find((check) => check.name === bitriseCheckName);
    };

    // Bitrise may not have reported its check run yet when this action starts: retry until the deadline.
    const startedAt = now();
    const deadline = startedAt + checkWaitTimeoutSeconds * 1000;
    let bitriseCheckRun = await findBitriseCheckRun();

    while (!bitriseCheckRun && now() < deadline) {
      const waitMs = Math.min(bitriseCheckPeriod, deadline - now());
      const waitedSeconds = Math.round((now() - startedAt) / 1000);
      core.info(
        `Check run "${bitriseCheckName}" not found yet on ${sha}; retrying in ${Math.ceil(waitMs / 1000)}s (waited ${waitedSeconds}s of ${checkWaitTimeoutSeconds}s)`,
      );
      await sleep(waitMs);
      bitriseCheckRun = await findBitriseCheckRun();
    }

    if (!bitriseCheckRun) {
      throw new Error(`Check run with name "${bitriseCheckName}" not found after waiting ${checkWaitTimeoutSeconds}s.`);
    }

    const externalId = bitriseCheckRun.external_id;

    if (!externalId) {
      throw new Error(`The check run "${bitriseCheckName}" does not have an external_id.`);
    }

    core.info(`External ID found: ${externalId}`);

    // Query the Bitrise API to check the build status
    const bitriseApiUrl = `https://api.bitrise.io/v0.1/${externalId}`;
    const headers = {
      Authorization: `${bitriseToken}`,
      'Content-Type': 'application/json',
    };

    let buildStatus = 0;
    let statusText = '';

    do {
      const response = await fetch(bitriseApiUrl, { headers });
      const bitriseData = (await response.json()) as { data: { status: number; status_text: string }; message?: string };

      if (!response.ok) {
        throw new Error(`Error querying the Bitrise API: ${bitriseData.message}`);
      }

      buildStatus = bitriseData.data.status;
      statusText = bitriseData.data.status_text;

      core.info(`Current Bitrise status: ${buildStatus} (${statusText})`);

      if (buildStatus === 0) {
        core.info('Build is still in progress. Waiting...');
        console.info(`Waiting for ${bitriseCheckPeriod} milliseconds before checking again...`);
        await new Promise((resolve) => setTimeout(resolve, bitriseCheckPeriod));

      }
    } while (buildStatus === 0);

    // Check the final result
    if (statusText !== 'success') {
      const errorMessage=`Bitrise build failed with status: ${statusText}`;
      core.setFailed(errorMessage);
      throw new Error(errorMessage);
    }

    core.info('Bitrise build completed successfully!');
    core.setOutput('bitrise_build_status', 'success');
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(String(error));
    }
  }
}