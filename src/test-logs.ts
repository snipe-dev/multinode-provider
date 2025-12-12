import { ethers } from 'ethers';
import { MultinodeJsonRpcProvider } from './modules/multinode-provider.js';

// Configuration - same providers
const rpcUrls = [
    'https://bsc-rpc.publicnode.com',      // Free tier (may return empty for logs)
    'http://65.108.192.118:8545',          // Full archive support
    'http://144.76.225.212:8545',          // Full archive support
];

/**
 * Tests getLogs() method specifically
 * Demonstrates how MultinodeJsonRpcProvider handles providers
 * with different log support levels
 */
async function testLogs() {
    console.log('=== Testing MultinodeJsonRpcProvider (Logs) ===\n');

    const provider = new MultinodeJsonRpcProvider(rpcUrls);

    try {
        // Get current block for range calculation
        const blockNumber = await provider.getBlockNumber();
        console.log(`Current block: ${blockNumber}\n`);

        // Define filter for Swap events in a specific PancakeSwap pair
        const PAIR_ADDRESS = '0x93A36A1Ac281F124b806841857f54209D6dba910';
        const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

        const filter = {
            address: PAIR_ADDRESS,
            topics: [SWAP_TOPIC],
            fromBlock: blockNumber - 1000,  // Last 1000 blocks
            toBlock: blockNumber
        };

        console.log('Filter parameters:');
        console.log(`  Contract: ${PAIR_ADDRESS}`);
        console.log(`  Event: Swap (${SWAP_TOPIC})`);
        console.log(`  Range: ${filter.fromBlock} → ${filter.toBlock} (${filter.toBlock - filter.fromBlock} blocks)\n`);

        // Test 1: ResilientJsonRpcProvider getLogs
        console.log('1. ResilientJsonRpcProvider.getLogs():');
        console.log('   Querying all providers in parallel...\n');

        const startTime = Date.now();
        const logs = await provider.getLogs(filter);
        const elapsed = Date.now() - startTime;

        console.log(`   Found ${logs.length} Swap events in ${elapsed}ms`);

        if (logs.length > 0) {
            console.log(`   First event details:`);
            console.log(`     Block: ${logs[0].blockNumber}`);
            console.log(`     Transaction: ${logs[0].transactionHash}`);

            // Decode and display event data
            try {
                const swapAbi = [
                    'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)'
                ];
                const iface = new ethers.Interface(swapAbi);
                const decoded = iface.decodeEventLog('Swap', logs[0].data, logs[0].topics);

                console.log(`     Sender: ${decoded.sender}`);
                console.log(`     To: ${decoded.to}`);
                console.log(`     Amount0In: ${ethers.formatUnits(decoded.amount0In, 18)}`);
                console.log(`     Amount1In: ${ethers.formatUnits(decoded.amount1In, 18)}`);
                console.log(`     Amount0Out: ${ethers.formatUnits(decoded.amount0Out, 18)}`);
                console.log(`     Amount1Out: ${ethers.formatUnits(decoded.amount1Out, 18)}`);
            } catch (e) {
                console.log(`     Could not decode: ${(e as Error).message}`);
            }
        }
        console.log('');

        // Test 2: Compare with single provider (for reference)
        console.log('2. Comparison with single provider:');
        const singleProvider = new ethers.JsonRpcProvider(rpcUrls[0]); // First URL

        try {
            const singleLogs = await singleProvider.getLogs(filter);
            console.log(`   Single provider (${rpcUrls[0]}):`);
            console.log(`     Found ${singleLogs.length} events`);
            console.log(`     Note: Free tier often returns 0 for large ranges\n`);
        } catch (error) {
            console.log(`   Single provider error: ${(error as Error).message}\n`);
        }

        // Test 3: Analyze log distribution
        if (logs.length > 0) {
            console.log('3. Log distribution analysis:');

            // Group logs by block
            const blockCounts = new Map<number, number>();
            logs.forEach(log => {
                const count = blockCounts.get(log.blockNumber) || 0;
                blockCounts.set(log.blockNumber, count + 1);
            });

            // Show top 5 blocks with most events
            const sortedBlocks = Array.from(blockCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);

            console.log(`   Top 5 blocks with Swap events:`);
            sortedBlocks.forEach(([blockNum, count]) => {
                console.log(`     Block ${blockNum}: ${count} events`);
            });

            // Calculate average events per block
            const totalBlocks = blockCounts.size;
            const avgPerBlock = logs.length / totalBlocks;
            console.log(`   Average: ${avgPerBlock.toFixed(2)} events per block\n`);
        }

        console.log('=== Logs test completed successfully ===');
        console.log(`Summary: Resilient provider found ${logs.length} events`);
        console.log('Note: Uses provider with most results to avoid free tier limitations');

    } catch (error) {
        console.error('Logs test failed:', error);
    }
}

// Execute logs test
testLogs().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});;