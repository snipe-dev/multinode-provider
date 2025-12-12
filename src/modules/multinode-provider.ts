import { ethers } from 'ethers';
import type {
    JsonRpcProvider,
    Block,
    TransactionResponse,
    TransactionReceipt,
    FeeData,
    Networkish,
    Filter,
    Log,
    TransactionRequest
} from 'ethers';

/**
 * Internal representation of a single RPC endpoint
 * paired with its ethers JsonRpcProvider instance.
 */
interface ProviderEntry {
    url: string;
    provider: JsonRpcProvider;
}

/**
 * Configuration options for MultinodeJsonRpcProvider.
 */
interface MultinodeJsonRpcProviderOptions {
    /**
     * Target network (chain id, network name, etc.).
     */
    network?: Networkish;

    /**
     * Timeout for getBlockNumber requests (milliseconds).
     * Used for fast head polling.
     */
    headTimeoutMs?: number;

    /**
     * Timeout for block, transaction and log related requests (milliseconds).
     */
    blockTimeoutMs?: number;

    /**
     * Allowed block height deviation when selecting consensus head.
     */
    consensusWindow?: number;

    /**
     * Custom multicall contract address.
     */
    multicallAddress?: string;
}

/**
 * Single multicall request definition.
 */
interface MulticallCall {
    target: string;
    callData: string;
}

/**
 * JsonRpcProvider wrapper that executes all requests
 * across multiple RPC nodes in parallel and returns
 * the most reliable result.
 *
 * This provider:
 * - Queries multiple RPC endpoints simultaneously
 * - Applies timeouts per request
 * - Uses consensus-based block number selection
 * - Automatically ignores failing or slow nodes
 *
 * The class extends ethers.JsonRpcProvider only for
 * type compatibility and seamless integration with
 * existing ethers-based modules.
 */
export class MultinodeJsonRpcProvider extends ethers.JsonRpcProvider {
    private readonly _providers: ProviderEntry[];
    private _lastHead: number = 0;

    private readonly _headTimeoutMs: number;
    private readonly _blockTimeoutMs: number;
    private readonly _consensusWindow: number;
    private readonly _multicallAddress: string;

    /**
     * Standard Multicall ABI used for batched read-only calls.
     */
    private readonly _multicallAbi = [
        "function tryAggregate(bool requireSuccess, (address target, bytes callData)[] calls) public view returns ((bool success, bytes returnData)[])"
    ];

    /**
     * Creates a new multinode JSON-RPC provider.
     *
     * @param rpcUrls List of RPC endpoints.
     * @param options Provider configuration.
     */
    constructor(rpcUrls: string[], options: MultinodeJsonRpcProviderOptions = {}) {
        if (!Array.isArray(rpcUrls) || rpcUrls.length === 0) {
            throw new Error("rpcUrls must be a non-empty array");
        }

        /**
         * JsonRpcProvider requires a single URL.
         * The first RPC endpoint is used only to satisfy
         * the base class constructor.
         *
         * Actual requests are executed via internal providers.
         */
        super(rpcUrls[0], options.network);

        this._headTimeoutMs = Number.isFinite(options.headTimeoutMs)
            ? options.headTimeoutMs!
            : 500;

        this._blockTimeoutMs = Number.isFinite(options.blockTimeoutMs)
            ? options.blockTimeoutMs!
            : 3000;

        this._consensusWindow = Number.isFinite(options.consensusWindow)
            ? options.consensusWindow!
            : 5;

        this._multicallAddress =
            options.multicallAddress ??
            "0xcA11bde05977b3631167028862bE2a173976CA11";

        this._providers = rpcUrls.map((url) => ({
            url,
            provider: new ethers.JsonRpcProvider(url, options.network)
        }));
    }

    // ============================
    // INTERNAL HELPERS
    // ============================

    /**
     * Wraps a promise with a timeout.
     * Rejects if the operation exceeds the given duration.
     */
    private _withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        let timer: NodeJS.Timeout | null = null;

        const timeoutPromise = new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error("RPC call timeout")), ms);
        });

        return Promise.race([
            promise.finally(() => {
                if (timer) clearTimeout(timer);
            }),
            timeoutPromise
        ]);
    }

    /**
     * Selects a consensus block number from multiple RPC responses.
     *
     * Uses median-based filtering and ignores outliers
     * outside the configured consensus window.
     */
    private _pickConsensusHead(numbers: number[]): number | null {
        if (!numbers.length) return null;

        const sorted = numbers.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 1 ? sorted[mid] : sorted[mid - 1];

        const window = this._consensusWindow;

        const inWindow = sorted.filter(
            (n) => n >= median - window && n <= median + window
        );

        const pool = inWindow.length ? inWindow : sorted;
        let best = pool[pool.length - 1];

        if (best < this._lastHead) {
            best = this._lastHead;
        }

        return best;
    }

    /**
     * Executes a request on all RPC providers in parallel
     * and returns the first valid result.
     *
     * @param task RPC operation executed on a provider
     * @param validate Optional result validation function
     */
    private async _executeParallel<T>(
        task: (provider: JsonRpcProvider) => Promise<T>,
        validate?: (result: T) => boolean
    ): Promise<T> {
        const results = await Promise.all(
            this._providers.map(async ({ provider, url }) => {
                try {
                    const result = await this._withTimeout(
                        task(provider),
                        this._blockTimeoutMs
                    );

                    if (!validate || validate(result)) {
                        return result;
                    }

                    throw new Error("Validation failed");
                } catch (error) {
                    console.log(`[RPC FAIL] ${url} → ${(error as Error).message}`);
                    return null;
                }
            })
        );

        const ok = results.find((r) => r !== null);
        if (!ok) {
            throw new Error("All RPC nodes failed");
        }

        return ok;
    }

    // ============================
    // PUBLIC API
    // ============================

    /**
     * Returns the latest block number using
     * consensus across all configured RPC nodes.
     */
    async getBlockNumber(): Promise<number> {
        const nums = await Promise.all(
            this._providers.map(async ({ provider }) => {
                try {
                    return await this._withTimeout(
                        provider.getBlockNumber(),
                        this._headTimeoutMs
                    );
                } catch {
                    return null;
                }
            })
        );

        const consensus = this._pickConsensusHead(
            nums.filter((n): n is number => n !== null)
        );

        if (consensus === null) {
            throw new Error("All RPC nodes failed for getBlockNumber()");
        }

        if (consensus > this._lastHead) {
            this._lastHead = consensus;
        }

        return this._lastHead;
    }

    /**
     * Returns a block by hash or block number.
     */
    async getBlock(
        blockHashOrNumber: string | number,
        includeTransactions?: boolean
    ): Promise<Block | null> {
        return this._executeParallel(
            p => p.getBlock(blockHashOrNumber, includeTransactions),
            b => !!(b && b.hash)
        );
    }

    /**
     * Executes a read-only EVM call.
     */
    async call(transaction: TransactionRequest): Promise<string> {
        return this._executeParallel(p => p.call(transaction));
    }

    /**
     * Executes multiple read-only calls using Multicall contract.
     *
     * @param calldata Array of contract calls
     * @returns Execution results for each call
     */
    async multicall(
        calldata: MulticallCall[]
    ): Promise<Array<{ success: boolean; returnData: string }>> {
        return this._executeParallel(async (provider) => {
            const multi = new ethers.Contract(
                this._multicallAddress,
                this._multicallAbi,
                provider
            );

            const formattedCalls = calldata.map(call => [
                call.target,
                call.callData
            ]) as [string, string][];

            return (multi as any).tryAggregate(false, formattedCalls);
        });
    }

    /**
     * Returns transaction by hash.
     */
    async getTransaction(hash: string): Promise<TransactionResponse | null> {
        return this._executeParallel(
            p => p.getTransaction(hash),
            tx => !!(tx && tx.hash)
        );
    }

    /**
     * Returns transaction receipt by hash.
     */
    async getTransactionReceipt(hash: string): Promise<TransactionReceipt | null> {
        return this._executeParallel(
            p => p.getTransactionReceipt(hash),
            r => !!(r && "status" in r)
        );
    }

    /**
     * Waits until transaction is mined and confirmed.
     */
    async waitForTransaction(
        hash: string,
        confirmations?: number,
        timeout?: number
    ): Promise<TransactionReceipt | null> {
        return this._executeParallel(
            p => p.waitForTransaction(hash, confirmations, timeout),
            r => !!(r && "status" in r)
        );
    }

    /**
     * Returns account balance at a specific block.
     */
    async getBalance(address: string, blockTag?: string | number): Promise<bigint> {
        return this._executeParallel(
            p => p.getBalance(address, blockTag)
        );
    }

    /**
     * Returns current gas fee data.
     */
    async getFeeData(): Promise<FeeData> {
        return this._executeParallel(p => p.getFeeData());
    }

    /**
     * Returns logs matching the given filter.
     * The result with the largest number of logs is selected.
     */
    async getLogs(filter: Filter): Promise<Log[]> {
        const results = await Promise.all(
            this._providers.map(async ({ provider }) => {
                try {
                    return await this._withTimeout(
                        provider.getLogs(filter),
                        this._blockTimeoutMs * 3
                    );
                } catch {
                    return [];
                }
            })
        );

        return results.reduce((a, b) => b.length > a.length ? b : a);
    }

    /**
     * Sends a raw JSON-RPC request.
     */
    async send(method: string, params: any[]): Promise<any> {
        return this._executeParallel(
            p => p.send(method, params)
        );
    }

    /**
     * Returns the latest consensus block number
     * observed by this provider.
     */
    getLastHead(): number {
        return this._lastHead;
    }
}
