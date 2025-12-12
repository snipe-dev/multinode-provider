import { ethers } from 'ethers';
import { MultinodeJsonRpcProvider } from './modules/multinode-provider.js';
import { BlockReader } from './modules/block-reader.js';

// Configuration
const rpcUrls = [
    'https://bsc-rpc.publicnode.com',
    'http://65.108.192.118:8545',
];

/**
 * Test BlockReader with MultinodeJsonRpcProvider
 * Demonstrates continuous block reading with event handling
 */
async function testBlockReader() {
    console.log('=== Testing BlockReader with ResilientJsonRpcProvider ===\n');

    // Create resilient provider
    const provider = new MultinodeJsonRpcProvider(rpcUrls);

    // Get current block to start from recent block
    const currentBlock = await provider.getBlockNumber();
    console.log(`Current blockchain height: ${currentBlock}\n`);

    // Create BlockReader instance
    console.log('Creating BlockReader...');
    const blockReader = new BlockReader(provider);

    // Set up event listeners
    blockReader.on('new_block', async (block) => {
        console.log(`\n📦 New Block #${block.number}:`);
        console.log(`   Hash: ${block.hash.substring(0, 16)}...`);
        console.log(`   Time: ${new Date(block.timestamp * 1000).toLocaleTimeString()}`);
        console.log(`   Transactions: ${block.transactions.length}`);

        // Process interesting transactions
        if (block.transactions.length > 0) {
            // Show first 2 transactions as example
            block.transactions.slice(0, 2).forEach((tx, i) => {
                console.log(`   TX ${i + 1}: ${tx.hash.substring(0, 16)}...`);
                console.log(`       From: ${tx.from.substring(0, 10)}...`);
                console.log(`       To: ${tx.to ? tx.to.substring(0, 10) + '...' : 'Contract Creation'}`);
                console.log(`       Value: ${ethers.formatEther(tx.value)} BNB`);
            });
        }
    });


    blockReader.on('error', (error) => {
        console.error('BlockReader error:', error.message);
    });

    setTimeout(() => {
        console.log('\n=== Test completed ===');
        console.log(`Last processed block: ${blockReader.getCurrentBlockNumber()}`);
        blockReader.stop();
        process.exit(0);
    }, 30000);
}

// Error handling for the test
testBlockReader().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});