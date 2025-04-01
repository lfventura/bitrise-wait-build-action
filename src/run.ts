import * as core from '@actions/core';
import * as github from '@actions/github';
import fetch from 'node-fetch';

export async function run(): Promise<void> {
  try {
    const githubToken: string = core.getInput('github_token');
    const bitriseToken: string = core.getInput('bitrise_token');
    const repo: string = core.getInput('repo');
    const owner: string = core.getInput('owner');
    const sha: string = core.getInput('sha');
    const bitriseCheckName: string = core.getInput('bitrise_check_name');
    const bitriseCheckPeriod: number = parseInt(core.getInput('bitrise_check_period'), 10) * 100;

    const octokit = github.getOctokit(githubToken);

    core.info(`Checking check runs for commit: ${sha}`);

    // Retrieve the external_id of the Bitrise check run
    const { data } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: sha,
    });

    const bitriseCheckRun = data.check_runs.find((check) => check.name === bitriseCheckName);

    if (!bitriseCheckRun) {
      throw new Error(`Check run with name "${bitriseCheckName}" not found.`);
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