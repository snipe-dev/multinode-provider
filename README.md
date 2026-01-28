# Multinode Ethereum Toolkit
### This `README.md` was created using ChatGPT because I was too lazy to write a description for this test project myself.😁

A lightweight infrastructure toolkit for building reliable Ethereum indexers, scanners and analytics services.

This repository contains multiple core components designed to work together, while still remaining usable independently.

---

## Components Overview

### MultinodeJsonRpcProvider

A resilient JSON-RPC provider for ethers.js that executes requests across multiple RPC endpoints in parallel and returns the most reliable result.

The provider is designed for applications that require increased reliability when working with unstable or rate-limited RPC nodes.

#### Key features

- Multiple RPC endpoints support
- Parallel request execution
- Per-request timeout protection
- Consensus-based block number selection
- Automatic fallback on failing nodes
- Compatible with ethers.js `Provider`
- Drop-in replacement for `JsonRpcProvider`

---

### BlockReader

`BlockReader` is a high-level block streaming component built on top of an ethers-compatible provider.

It is designed for sequential and deterministic block processing, which is required for:

- indexers
- event scanners
- historical block processors
- real-time block consumers

BlockReader is **not a test module**.  
It is a core infrastructure component intended for production workloads.

#### Responsibilities

BlockReader is responsible for:

- sequential block iteration
- safe block number progression
- provider-agnostic execution
- deterministic processing order
- fault-tolerant retries
- clean separation between data fetching and business logic

It intentionally does **not** contain application logic.

Instead, it acts as a stable execution engine that calls user-defined handlers.

---

## Design Philosophy

This repository intentionally groups multiple infrastructure components together instead of splitting them into separate repositories.

Reasons:

- components are tightly related conceptually
- they evolve together
- they are commonly used as a single stack
- separating them would introduce unnecessary fragmentation

Each class remains independent, but shares common architectural principles.

---

## MultinodeJsonRpcProvider – Design Overview

Internally, the provider maintains multiple `JsonRpcProvider` instances.

For each request:

1. The same RPC call is executed in parallel on all configured nodes
2. Each request is protected by a timeout
3. Invalid or failed responses are ignored
4. The first valid response is returned

For block number polling, a consensus algorithm is applied to avoid outliers and desynchronized nodes.

---

## BlockReader – Execution Model

BlockReader operates in a strictly ordered manner.

General flow:

1. determine starting block
2. fetch next block
3. process block via user callback
4. persist progress externally
5. continue iteration

This ensures:

- no skipped blocks
- no duplicate processing
- predictable restart behavior
- deterministic state recovery

BlockReader does not assume any storage mechanism.

Persistence is delegated to the user.

---

## Installation

```bash
npm install
```

No additional runtime dependencies are required.

---

## Basic Usage

### Provider

```ts
const rpcUrls =   [
    "https://rpc.ankr.com/eth",
    "https://cloudflare-eth.com",
    "https://ethereum.publicnode.com"
];

const provider = new MultinodeJsonRpcProvider(rpcUrls);
const blockNumber = await provider.getBlockNumber();

```

### BlockReader

```ts
import { BlockReader } from './modules/block-reader.js';

const blockReader = new BlockReader(provider);
blockReader.on('new_block', async (block) => {
    console.log(`\n📦 New Block #${block.number}:`)
});

```

---

## Intended Use Cases

- blockchain indexers
- event scanners
- historical data ingestion
- analytics pipelines
- monitoring services
- archive processors

---

## Scope and Limitations

- read-only infrastructure
- no transaction signing
- no transaction broadcasting
- no database coupling
- no opinionated persistence layer

This repository focuses purely on execution reliability and determinism.

---
