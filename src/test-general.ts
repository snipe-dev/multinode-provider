import { ethers } from 'ethers';
import { MultinodeJsonRpcProvider } from './modules/multinode-provider.js';

// Configuration
const rpcUrls = [
    'https://bsc-rpc.publicnode.com',
    'http://65.108.192.118:8545',
    'http://144.76.225.212:8545',
];

/**
 * Tests basic functionality of MultinodeJsonRpcProvider
 * Excludes getLogs() which is tested separately
 */
async function testGeneralMethods() {
    console.log('=== Testing MultinodeJsonRpcProvider (General Methods) ===\n');

    const provider = new MultinodeJsonRpcProvider(rpcUrls);

    try {
        // Test 1: getBlockNumber - Core consensus method
        console.log('1. Testing getBlockNumber() - consensus algorithm');
        const blockNumber = await provider.getBlockNumber();
        console.log(`   Current block: ${blockNumber}\n`);

        // Test 2: getFeeData - Gas price information
        console.log('2. Testing getFeeData() - gas prices');
        const feeData = await provider.getFeeData();
        console.log(`   Gas Price: ${ethers.formatUnits(feeData.gasPrice || 0n, 'gwei')} gwei`);
        console.log(`   Max Fee Per Gas: ${feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') + ' gwei' : 'N/A (BSC)'}`);
        console.log(`   Max Priority Fee Per Gas: ${feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei') + ' gwei' : 'N/A (BSC)'}\n`);

        // Test 3: getBlock - Block data retrieval
        console.log('3. Testing getBlock() - block data');
        const block = await provider.getBlock(blockNumber - 1); // Previous block
        console.log(`   Block ${blockNumber - 1}:`);
        console.log(`     Hash: ${block?.hash}`);
        console.log(`     Timestamp: ${block?.timestamp}`);
        console.log(`     Transactions: ${block?.transactions.length}\n`);

        // Test 4: getBalance - Address balance check
        console.log('4. Testing getBalance() - address balance');
        const testAddress = '0xB265A4B2136F2C5343cbE8DCe74dBDCd8786aE1E';
        const balance = await provider.getBalance(testAddress);
        console.log(`   Address: ${testAddress}`);
        console.log(`   Balance: ${ethers.formatEther(balance)} BNB\n`);

        // Test 5: multicall - Batch contract calls
        console.log('5. Testing multicall() - batch contract calls');
        const tokenAddress = '0xe6DF05CE8C8301223373CF5B969AFCb1498c5528';

        // Prepare function calls
        const calldata = [
            { target: tokenAddress, callData: '0x313ce567' }, // decimals()
            { target: tokenAddress, callData: '0x95d89b41' }, // symbol()
            { target: tokenAddress, callData: '0x18160ddd' }  // totalSupply()
        ];

        console.log('   Calling: decimals(), symbol(), totalSupply()');
        const multicallResult = await provider.multicall(calldata);

        // Decode and display results
        const iface = new ethers.Interface([
            'function decimals() view returns (uint8)',
            'function symbol() view returns (string)',
            'function totalSupply() view returns (uint256)'
        ]);

        multicallResult.forEach((result, index) => {
            console.log(`   Result ${index + 1}: ${result.success ? 'Success' : 'Failed'}`);
            if (result.success) {
                try {
                    const decoded = iface.decodeFunctionResult(
                        index === 0 ? 'decimals' : index === 1 ? 'symbol' : 'totalSupply',
                        result.returnData
                    );
                    console.log(`     Decoded: ${decoded[0]}`);
                } catch (e) {
                    console.log(`     Raw data: ${result.returnData}`);
                }
            }
        });
        console.log('');

        // Test 6: getTransaction & getTransactionReceipt - Transaction data
        console.log('6. Testing getTransaction() & getTransactionReceipt()');
        const txHash = '0x5dd3a01fc52c3f99947e0ed3d5e9adf579fdc36ee49b7ee6e1fc6bb0952ddf76';

        console.log(`   Transaction hash: ${txHash}`);

        const tx = await provider.getTransaction(txHash);
        if (tx) {
            console.log(`   Transaction details:`);
            console.log(`     From: ${tx.from}`);
            console.log(`     To: ${tx.to}`);
            console.log(`     Value: ${ethers.formatEther(tx.value)} BNB`);
            console.log(`     Gas Price: ${ethers.formatUnits(tx.gasPrice || 0n, 'gwei')} gwei`);
            console.log(`     Block: ${tx.blockNumber || 'Pending'}`);
        } else {
            console.log(`   Transaction not found`);
        }

        const receipt = await provider.getTransactionReceipt(txHash);
        if (receipt) {
            console.log(`\n   Transaction receipt:`);
            console.log(`     Block: ${receipt.blockNumber}`);
            console.log(`     Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
            console.log(`     Gas Used: ${receipt.gasUsed.toString()}`);
            console.log(`     Logs: ${receipt.logs.length}`);
        } else {
            console.log(`   Receipt not found`);
        }
        console.log('');

        // Test 7: waitForTransaction - For already mined transaction
        console.log('7. Testing waitForTransaction() for already mined transaction');
        console.log('   Note: waitForTransaction returns receipt immediately for already mined transactions');

        // For already mined transactions, we can use 0 confirmations and short timeout
        const waitReceipt = await provider.waitForTransaction(txHash, 0, 5000);
        if (waitReceipt) {
            console.log(`   Transaction confirmed:`);
            console.log(`     Block: ${waitReceipt.blockNumber}`);
            console.log(`     Status: ${waitReceipt.status === 1 ? 'Success' : 'Failed'}`);
            console.log(`     This is the same as getTransactionReceipt() result`);
        } else {
            console.log(`   Transaction not found`);
        }
        console.log('');

        // Test 8: Utility method
        console.log('8. Testing utility method');
        console.log(`   Last consensus head: ${provider.getLastHead()}\n`);

        console.log('=== All general tests completed successfully ===');
        console.log('\nNote: The provider works correctly even if some nodes fail.');
        console.log('      It returns results from the first working node.');

    } catch (error) {
        console.error('Test failed:', error);
    }
}

// Execute tests
testGeneralMethods().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});;