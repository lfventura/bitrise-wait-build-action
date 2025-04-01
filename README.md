# Bitrise Wait Build Action

![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

A GitHub Action to wait for a Bitrise build to complete before proceeding with the workflow.

## 📋 Description

This action checks the status of a Bitrise build associated with a specific commit in GitHub. It waits until the build is complete and returns the final status (success or failure). If the build fails, the action stops the workflow.

## 🚀 How to Use

Add the action to your GitHub workflow file (`.github/workflows/<workflow>.yml`):

```yaml
name: Wait for Bitrise Build

on:
  push:
    branches:
      - main

jobs:
  wait-for-bitrise:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Wait for Bitrise Build
        uses: lfventura/bitrise-wait-build-action@main
        with:
          bitrise_token: ${{ secrets.BITRISE_TOKEN }}
          bitrise_check_period: 90 # In seconds
```

## ⚙️ Inputs

| Name                   | Required | Description                                                              | Default       |
|------------------------|----------|--------------------------------------------------------------------------|---------------|
| `github_token`         | Yes      | GitHub token for authentication.      | `${{ secrets.GITHUB_TOKEN }}           |
| `bitrise_token`        | Yes      | Bitrise API token.                   | `${{ secrets.BITRISE_TOKEN }}`           |
| `repo`                 | Yes      | Name of the GitHub repository.                                           | `${{ github.event.repository.name }}`           |
| `owner`                | Yes      | Owner of the GitHub repository.                                          | `${{ github.repository_owner }}`          |
| `sha`                  | Yes      | Commit SHA to check the build status.                                    | `${{ github.event.pull_request.head.sha }}` |
| `bitrise_check_name`   | Yes      | Name of the check run associated with Bitrise.                           | `Bitrise`  |
| `bitrise_check_period` | Yes      | Time interval (in seconds) between build status | `60`

## 🛠️ Development

### Prerequisites

- Node.js (>= 20.x)
- npm

## 🛠️ How It Works

This GitHub Action interacts with the Bitrise API and GitHub's Checks API to monitor the status of a build associated with a specific commit. Here's how it works:

1. **Inputs Configuration**:
   - The action receives inputs such as `github_token`, `bitrise_token`, `repo`, `owner`, `sha`, and others to identify the repository and commit to monitor.

2. **Retrieve Check Run**:
   - The action uses the GitHub API to find the check run associated with the specified `bitrise_check_name` for the given commit (`sha`).

3. **Fetch External ID**:
   - Once the check run is found, the action retrieves the `external_id` associated with the Bitrise build.

4. **Query Bitrise API**:
   - The action queries the Bitrise API using the `external_id` to check the status of the build.

5. **Polling for Status**:
   - The action repeatedly polls the Bitrise API at intervals defined by `bitrise_check_period` (default: 60 seconds) until the build is complete.

6. **Handle Build Result**:
   - If the build succeeds, the action sets the output `bitrise_build_status` to `success`.
   - If the build fails, the action stops the workflow and marks it as failed.

7. **Logs and Outputs**:
   - The action logs the current status of the build during each polling iteration.
   - Once the build is complete, it logs the final status and sets the appropriate output or failure message.

This ensures that your workflow waits for the Bitrise build to complete before proceeding, providing seamless integration between GitHub Actions and Bitrise.

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-username/bitrise-wait-build-action.git
cd bitrise-wait-build-action
npm install
```

### Running Tests

Run the tests with:

```bash
npm run test
```

Run local-action tests:

First create a .env file with the format INPUT_<INPUT_NAME>. Use real data as it will actually hit the APIs, as the following example:

```bash
INPUT_GITHUB_TOKEN=""
INPUT_OWNER=""
INPUT_REPO=""
INPUT_BITRISE_TOKEN=""
INPUT_SHA=""
```

Run the local-test

```bash
npm run local-test 
```


### Linting

Check the code with:

```bash
npm run lint
```

### Building

Build the code with:

```bash
npm run build
```

## 🧪 Test Examples

The tests are located in the `src/run.test.ts` file. They cover the following scenarios:

- Build succeeds after 2 iterations.
- Build fails after 2 iterations.
- Error querying the Bitrise API.
- Check run not found in GitHub.

## 📄 License

This project is licensed under the [MIT License](LICENSE).
