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

        mockedPaginate.mockResolvedValue([
            {
                name: mockInputs.bitrise_check_name,
                external_id: 'mock-external-id',
            },
        ]);
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
        mockedPaginate.mockResolvedValueOnce([]);

        await run();

        expect(mockedCore.setFailed).toHaveBeenCalledWith('Check run with name "mock-bitrise-check-name" not found.');
    });

    it('should fail if the Bitrise check run does not have an external_id', async () => {
        mockedPaginate.mockResolvedValueOnce([
            {
                name: mockInputs.bitrise_check_name,
                external_id: null,
            },
        ]);

        await run();

        expect(mockedCore.setFailed).toHaveBeenCalledWith('The check run "mock-bitrise-check-name" does not have an external_id.');
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