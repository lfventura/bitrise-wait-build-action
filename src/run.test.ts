import * as core from '@actions/core';
import * as github from '@actions/github';
import { run } from './run';

jest.mock('@actions/core');
jest.mock('@actions/github');

const mockedCore = core as jest.Mocked<typeof core>;
const mockedGithub = github as jest.Mocked<typeof github>;
const mockedFetch = jest.fn() as jest.MockedFunction<typeof global.fetch>;
const mockedPaginate = jest.fn();
const mockedListForRef = jest.fn();

type MockCheckRun = { name?: string | null; external_id?: string | null };

/**
 * Drives the `mapFn` passed to `octokit.paginate` the same way the real
 * `@octokit/plugin-paginate-rest` does: each page is handed over already
 * normalized, meaning `response.data` is the `check_runs` array itself and not
 * the `{ total_count, check_runs }` wrapper returned by the REST endpoint.
 * `done()` stops paging, and the accumulated pages are concatenated.
 */
function paginateWithPages(pages: MockCheckRun[][]) {
    return async (
        _route: unknown,
        _params: unknown,
        mapFn?: (response: { data: MockCheckRun[] }, done: () => void) => MockCheckRun[],
    ) => {
        let results: MockCheckRun[] = [];

        for (const page of pages) {
            if (!mapFn) {
                results = results.concat(page);
                continue;
            }

            let earlyExit = false;
            const done = () => {
                earlyExit = true;
            };

            results = results.concat(mapFn({ data: page }, done));

            if (earlyExit) break;
        }

        return results;
    };
}

describe('run', () => {
    const mockInputs = {
        github_token: 'mock-github-token',
        bitrise_token: 'mock-bitrise-token',
        repo: 'mock-repo',
        owner: 'mock-owner',
        sha: 'mock-sha',
        bitrise_check_name: 'mock-bitrise-check-name',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = mockedFetch;

        mockedCore.getInput.mockImplementation((name: string) => mockInputs[name as keyof typeof mockInputs]);

        mockedGithub.getOctokit.mockReturnValue({
            paginate: mockedPaginate,
            rest: {
                checks: {
                    listForRef: mockedListForRef,
                },
            },
        } as any);

        mockedPaginate.mockImplementation(
            paginateWithPages([
                [
                    {
                        name: mockInputs.bitrise_check_name,
                        external_id: 'mock-external-id',
                    },
                ],
            ]),
        );
    });

    it('should complete successfully when the Bitrise build succeeds', async () => {
        mockedFetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                data: {
                    status: 1,
                    status_text: 'success',
                },
            }),
        } as any);

        await run();

        expect(mockedPaginate).toHaveBeenCalledWith(
            mockedListForRef,
            expect.objectContaining({
                owner: mockInputs.owner,
                repo: mockInputs.repo,
                ref: mockInputs.sha,
                per_page: 100,
            }),
            expect.any(Function),
        );
        expect(mockedCore.setOutput).toHaveBeenCalledWith('bitrise_build_status', 'success');
        expect(mockedCore.info).toHaveBeenCalledWith('Bitrise build completed successfully!');
    });

    it('should fail if the Bitrise check run is not found', async () => {
        mockedPaginate.mockImplementation(paginateWithPages([[]]));

        await run();

        expect(mockedCore.setFailed).toHaveBeenCalledWith('Check run with name "mock-bitrise-check-name" not found.');
    });

    it('should fail if the Bitrise check run does not have an external_id', async () => {
        mockedPaginate.mockImplementation(
            paginateWithPages([
                [
                    {
                        name: mockInputs.bitrise_check_name,
                        external_id: null,
                    },
                ],
            ]),
        );

        await run();

        expect(mockedCore.setFailed).toHaveBeenCalledWith('The check run "mock-bitrise-check-name" does not have an external_id.');
    });

    it('should read the normalized check run array from the paginate map callback', async () => {
        // Regression guard for the crash observed in production: octokit.paginate
        // hands the map callback an already-normalized response, so reading
        // `response.data.check_runs` threw "Cannot read properties of undefined
        // (reading 'find')" and the action never reached the Bitrise API.
        mockedPaginate.mockImplementation(
            paginateWithPages([
                [
                    { name: 'some-other-check', external_id: 'other-external-id' },
                    { name: mockInputs.bitrise_check_name, external_id: 'mock-external-id' },
                ],
            ]),
        );

        mockedFetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                data: {
                    status: 1,
                    status_text: 'success',
                },
            }),
        } as any);

        await run();

        expect(mockedCore.setFailed).not.toHaveBeenCalled();
        expect(mockedFetch).toHaveBeenCalledWith('https://api.bitrise.io/v0.1/mock-external-id', expect.anything());
        expect(mockedCore.info).toHaveBeenCalledWith('External ID found: mock-external-id');
        expect(mockedCore.setOutput).toHaveBeenCalledWith('bitrise_build_status', 'success');
    });

    it('should stop paginating as soon as the Bitrise check run is found', async () => {
        const mapFnCalls: MockCheckRun[][] = [];

        mockedPaginate.mockImplementation(
            async (
                _route: unknown,
                _params: unknown,
                mapFn: (response: { data: MockCheckRun[] }, done: () => void) => MockCheckRun[],
            ) => {
                const pages: MockCheckRun[][] = [
                    [{ name: mockInputs.bitrise_check_name, external_id: 'mock-external-id' }],
                    [{ name: 'never-reached', external_id: 'never-reached-external-id' }],
                ];

                let results: MockCheckRun[] = [];

                for (const page of pages) {
                    mapFnCalls.push(page);

                    let earlyExit = false;
                    results = results.concat(mapFn({ data: page }, () => {
                        earlyExit = true;
                    }));

                    if (earlyExit) break;
                }

                return results;
            },
        );

        mockedFetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                data: {
                    status: 1,
                    status_text: 'success',
                },
            }),
        } as any);

        await run();

        expect(mapFnCalls).toHaveLength(1);
        expect(mockedCore.info).toHaveBeenCalledWith('External ID found: mock-external-id');
    });

    it('should keep paginating until the Bitrise check run shows up on a later page', async () => {
        mockedPaginate.mockImplementation(
            paginateWithPages([
                [{ name: 'first-page-check', external_id: 'first-page-external-id' }],
                [{ name: mockInputs.bitrise_check_name, external_id: 'mock-external-id' }],
            ]),
        );

        mockedFetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                data: {
                    status: 1,
                    status_text: 'success',
                },
            }),
        } as any);

        await run();

        expect(mockedCore.info).toHaveBeenCalledWith('External ID found: mock-external-id');
        expect(mockedCore.setOutput).toHaveBeenCalledWith('bitrise_build_status', 'success');
    });

    it('should fail if the Bitrise API returns an error', async () => {
        mockedFetch.mockResolvedValueOnce({
            ok: false,
            json: jest.fn().mockResolvedValue({
                message: 'Mock API error',
            }),
        } as any);

        await run();

        expect(mockedCore.setFailed).toHaveBeenCalledWith('Error querying the Bitrise API: Mock API error');
    });

    it('should fail if the Bitrise build status is not success', async () => {

        mockedFetch.mockResolvedValueOnce({
            ok: true,
            json: jest.fn().mockResolvedValue({
                data: {
                    status: 2,
                    status_text: 'failed',
                },
            }),
        } as any);
    
    
        await run();
    
        expect(mockedCore.setFailed).toHaveBeenCalledWith('Bitrise build failed with status: failed');
    });

    it('should handle build_status === 0 for 2 iterations and then succeed', async () => {
        mockedCore.getInput.mockImplementation((name: string) => {
            if (name === 'bitrise_check_period') return '1'; // 1 segundo
            return mockInputs[name as keyof typeof mockInputs];
        });

        mockedFetch
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    data: {
                        status: 0,
                        status_text: 'in-progress',
                    },
                }),
            } as any)
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    data: {
                        status: 0,
                        status_text: 'in-progress',
                    },
                }),
            } as any)
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    data: {
                        status: 1,
                        status_text: 'success',
                    },
                }),
            } as any);
    
        await run();
    
        expect(mockedCore.info).toHaveBeenCalledWith('Build is still in progress. Waiting...');
        expect(mockedCore.info).toHaveBeenCalledWith('Bitrise build completed successfully!');
        expect(mockedCore.setOutput).toHaveBeenCalledWith('bitrise_build_status', 'success');
    });
    
    it('should handle build_status === 0 for 2 iterations and then fail', async () => {
        mockedCore.getInput.mockImplementation((name: string) => {
            if (name === 'bitrise_check_period') return '1'; // 1 segundo
            return mockInputs[name as keyof typeof mockInputs];
        });
        
        mockedFetch
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    data: {
                        status: 0,
                        status_text: 'in-progress',
                    },
                }),
            } as any)
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    data: {
                        status: 0,
                        status_text: 'in-progress',
                    },
                }),
            } as any)
            .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    data: {
                        status: 2,
                        status_text: 'failed',
                    },
                }),
            } as any);
    
        await run();
    
        expect(mockedCore.info).toHaveBeenCalledWith('Build is still in progress. Waiting...');
        expect(mockedCore.setFailed).toHaveBeenCalledWith('Bitrise build failed with status: failed');
    });
});