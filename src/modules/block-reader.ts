import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'eventemitter3';
import type { Block, Provider } from 'ethers';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to store last processed block
const LAST_BLOCK_FILE = path.join(__dirname, '..', '..', 'block.txt');

// Utility function to delay execution
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Interface for transaction data from block
export interface BlockTransactionData {
    hash: string;
    blockNumber: number | null;
    blockHash: string | null;
    index: number;
    type: number;
    to: string | null;
    from: string;
    nonce: number;
    gasLimit: bigint;
    gasPrice: bigint | null;
    maxPriorityFeePerGas: bigint | null;
    maxFeePerGas: bigint | null;
    data: string;
    value: bigint;
    chainId: bigint;
}

// Types for emitted events
export interface BlockData {
    source: string;
    number: number;
    hash: string;
    timestamp: number;
    transactions: BlockTransactionData[];
}

export interface TransactionData extends BlockTransactionData {
    source: string;
}

export interface BlockReaderEvents {
    'new_block': (block: BlockData) => void;
    'new_transaction': (transaction: TransactionData) => void;
    'error': (error: Error) => void;
}

/**
 * BlockReader continuously reads new blocks from the blockchain
 * using a resilient provider and emits events for blocks and transactions.
 *
 * Features:
 * - Tracks last processed block in file storage
 * - Handles network errors with retries
 * - Processes blocks in parallel for performance
 * - Emits events for new blocks and transactions
 * - Prevents duplicate processing
 */
export class BlockReader extends EventEmitter<BlockReaderEvents> {
    private provider: Provider;
    private expectedBlockNumber: number = 0;

    // Configuration
    private readonly maxAttempts: number = 3;
    private readonly rereadBlocks: number = 10;
    private readonly maxParallelBlocks: number = 5;

    // State tracking
    private processedBlocks: number[] = [];
    private processedTransactions: string[] = [];

    /**
     * Creates a new BlockReader instance
     * @param provider RPC provider instance (MultinodeJsonRpcProvider or any ethers.Provider)
     */
    constructor(provider: Provider) {
        super();

        if (!provider) {
            throw new Error("BlockReader requires a provider instance");
        }

        this.provider = provider;

        // Start reading blocks (non-blocking)
        this.start().catch(error => {
            this.emit('error', error as Error);
        });
    }

    /**
     * Initializes the BlockReader by loading the last processed block
     * and starting the block reading loop
     */
    private async start(): Promise<void> {
        try {
            this.expectedBlockNumber = await this.loadLastProcessedBlock() + 1;
            console.log("Last processed block:", this.expectedBlockNumber);
            await this.readBlocksLoop();
        } catch (error) {
            this.emit('error', error as Error);
        }
    }

    /**
     * Main loop that continuously reads new blocks
     */
    private async readBlocksLoop(): Promise<void> {
        try {
            let head = await this.provider.getBlockNumber();

            // If chain reorg happened, adjust expected block number
            if (head < this.expectedBlockNumber) {
                head = this.expectedBlockNumber;
            }

            let nextBlock = this.expectedBlockNumber;
            const fetchedBlocks = new Map<number, Block>();

            // Fetch blocks in parallel batches
            while (nextBlock <= head) {
                const batch: Promise<void>[] = [];

                // Create batch of block requests
                for (let i = 0; i < this.maxParallelBlocks && nextBlock <= head; i++, nextBlock++) {
                    const blockNumber = nextBlock;
                    batch.push(
                        this.tryGetBlock(blockNumber, this.maxAttempts)
                            .then(block => {
                                if (block) {
                                    fetchedBlocks.set(blockNumber, block);
                                }
                            })
                    );
                }

                // Wait for batch to complete
                await Promise.all(batch);

                // Process blocks in order
                while (fetchedBlocks.has(this.expectedBlockNumber)) {
                    const block = fetchedBlocks.get(this.expectedBlockNumber)!;
                    fetchedBlocks.delete(this.expectedBlockNumber);

                    const blockData = await this.processBlock(block);
                    await this.saveLastProcessedBlock(this.expectedBlockNumber);

                    this.emit('new_block', blockData);
                    this.expectedBlockNumber++;
                }
            }
        } catch (error) {
            this.emit('error', error as Error);
        }

        // Continue reading after delay
        setTimeout(() => this.readBlocksLoop(), 1000);
    }

    /**
     * Attempts to fetch a block with retries
     * @param blockNumber Block number to fetch
     * @param maxAttempts Maximum number of retry attempts
     * @returns Block data or null if all attempts fail
     */
    private async tryGetBlock(blockNumber: number, maxAttempts: number = 3): Promise<Block | null> {
        let attempts = 0;

        while (attempts < maxAttempts) {
            try {
                const block = await this.provider.getBlock(blockNumber, true);
                if (block && block.hash) {
                    return block;
                }
            } catch (error) {
                attempts++;
                console.error(
                    `Error getting block ${blockNumber} (attempt ${attempts}):`,
                    error
                );

                if (attempts < maxAttempts) {
                    await sleep(1000);
                }
            }

            // This covers the case where block exists but has no hash
            attempts++;
        }

        return null;
    }

    /**
     * Converts a TransactionResponse-like object to our BlockTransactionData type
     * @param tx Transaction object from block
     * @returns Normalized transaction data
     */
    private normalizeTransaction(tx: any): BlockTransactionData {
        return {
            hash: tx.hash || '',
            blockNumber: tx.blockNumber || null,
            blockHash: tx.blockHash || null,
            index: tx.index || tx.transactionIndex || 0,
            type: tx.type || 0,
            to: tx.to || null,
            from: tx.from || '',
            nonce: tx.nonce || 0,
            gasLimit: BigInt(tx.gasLimit || tx.gas || 0),
            gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : null,
            maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : null,
            maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : null,
            data: tx.data || '0x',
            value: BigInt(tx.value || 0),
            chainId: BigInt(tx.chainId || 0),
        };
    }

    /**
     * Processes a raw block into our internal format
     * @param block Raw block from provider
     * @returns Processed block data
     */
    private async processBlock(block: Block): Promise<BlockData> {
        const blockData: BlockData = {
            source: "READER",
            number: block.number!,
            hash: block.hash!,
            timestamp: block.timestamp,
            transactions: []
        };

        // Process transactions in the block
        // When getBlock is called with includeTransactions: true,
        // transactions are TransactionResponse objects
        if (block.transactions && block.transactions.length > 0) {
            // Check if transactions are TransactionResponse objects (not just hashes)
            if (typeof block.transactions[0] === 'string') {
                // Optionally fetch full transactions by hash
                // This is more expensive but gives full data
                const txPromises = (block.transactions as string[]).map(hash =>
                    this.provider.getTransaction(hash).catch(() => null)
                );

                const txResults = await Promise.all(txPromises);
                for (const tx of txResults) {
                    if (tx) {
                        const normalizedTx = this.normalizeTransaction(tx);
                        blockData.transactions.push(normalizedTx);

                        const txData: TransactionData = {
                            ...normalizedTx,
                            source: 'block'
                        };
                        this.processTransaction(txData);
                    }
                }
            } else {
                // They are TransactionResponse objects
                for (const tx of block.transactions as any[]) {
                    const normalizedTx = this.normalizeTransaction(tx);
                    blockData.transactions.push(normalizedTx);

                    const txData: TransactionData = {
                        ...normalizedTx,
                        source: 'block'
                    };
                    this.processTransaction(txData);
                }
            }
        }

        // Log block info
        if (!this.processedBlocks.includes(blockData.number)) {
            console.log(
                blockData.source,
                this.formatBlockTime(blockData.timestamp),
                blockData.number,
                "transactions:",
                blockData.transactions.length
            );

            this.processedBlocks.push(blockData.number);
            if (this.processedBlocks.length > 100) {
                this.processedBlocks.shift();
            }
        }

        return blockData;
    }

    /**
     * Processes a transaction and emits event
     * @param transaction Transaction data
     */
    private processTransaction(transaction: TransactionData): void {
        if (!this.processedTransactions.includes(transaction.hash)) {
            this.processedTransactions.push(transaction.hash);

            this.emit('new_transaction', transaction);

            // Keep memory usage in check
            if (this.processedTransactions.length > 2000) {
                this.processedTransactions.shift();
            }
        }
    }

    /**
     * Formats block timestamp to human-readable string
     * @param timestamp Unix timestamp
     * @returns Formatted date string
     */
    private formatBlockTime(timestamp: number): string {
        const blockTime = new Date(timestamp * 1000);
        return `${blockTime.toLocaleDateString()} ${blockTime.toLocaleTimeString()}`;
    }

    /**
     * Loads last processed block from file
     * @returns Last processed block number
     */
    private async loadLastProcessedBlock(): Promise<number> {
        try {
            const data = await fs.readFile(LAST_BLOCK_FILE, 'utf8');
            let lastProcessedBlock = parseInt(data, 10) || 0;

            // Check if we're too far behind current chain
            try {
                const currentBlock = await this.provider.getBlockNumber();

                // If we're more than rereadBlocks behind, start from recent block
                if (currentBlock - lastProcessedBlock > this.rereadBlocks || !lastProcessedBlock) {
                    const newStartBlock = currentBlock - this.rereadBlocks;
                    await this.saveLastProcessedBlock(newStartBlock);
                    return newStartBlock;
                }
            } catch (error) {
                this.emit('error', error as Error);
            }

            return lastProcessedBlock;

        } catch (error) {
            // File doesn't exist or can't be read, start from current block
            try {
                const currentBlock = await this.provider.getBlockNumber();
                await this.saveLastProcessedBlock(currentBlock);
                return currentBlock;
            } catch (error) {
                this.emit('error', error as Error);
                return 0;
            }
        }
    }

    /**
     * Saves last processed block to file
     * @param blockNumber Block number to save
     */
    private async saveLastProcessedBlock(blockNumber: number): Promise<void> {
        await fs.writeFile(LAST_BLOCK_FILE, blockNumber.toString(), 'utf8');
    }

    /**
     * Checks transaction status by waiting for receipt
     * @param hash Transaction hash
     * @returns Promise that resolves to true if transaction succeeded
     */
    public async checkTransactionStatus(hash: string): Promise<boolean> {
        try {
            const receipt = await this.provider.waitForTransaction(hash, 0, 10000);
            return !!(receipt && receipt.status === 1);
        } catch (error) {
            console.error(`Error checking transaction ${hash}:`, error);
            return false;
        }
    }

    /**
     * Gets the current expected block number
     * @returns Current expected block number
     */
    public getCurrentBlockNumber(): number {
        return this.expectedBlockNumber;
    }

    /**
     * Resets the reader to start from a specific block
     * @param blockNumber Block number to start from
     */
    public async resetToBlock(blockNumber: number): Promise<void> {
        this.expectedBlockNumber = blockNumber;
        await this.saveLastProcessedBlock(blockNumber);
        console.log(`BlockReader reset to block ${blockNumber}`);
    }

    /**
     * Stops the block reader (clears pending timeouts)
     * Note: This is a basic implementation, you might need to extend it
     * based on your specific needs for clean shutdown.
     */
    public stop(): void {
        // Remove all listeners
        this.removeAllListeners();
        console.log('BlockReader stopped');
    }
}