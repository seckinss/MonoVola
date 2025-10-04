/**
 * Keep Blockchain Alive Script
 * 
 * This script automatically mines blocks on a local blockchain to keep the timestamp advancing.
 * Useful for testing time-sensitive contracts on Anvil/Hardhat.
 * 
 * Usage:
 *   node packages/foundry/scripts-js/keepBlockchainAlive.js
 *   or
 *   yarn chain:keep-alive
 * 
 * Stop with Ctrl+C
 */

import { ethers } from "ethers";

// Configuration
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || "500"); // Mine every 2 seconds
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Anvil account #0

async function main() {
  console.log("🚀 Starting Keep Blockchain Alive Script");
  console.log(`📡 RPC: ${RPC_URL}`);
  console.log(`⏱️  Interval: ${INTERVAL_MS}ms (${INTERVAL_MS / 1000}s)`);
  console.log("⚠️  Press Ctrl+C to stop\n");

  // Connect to local blockchain (ethers v5 syntax)
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`📍 Using address: ${wallet.address}`);

  // Check connection
  try {
    const network = await provider.getNetwork();
    console.log(`✅ Connected to chain ID: ${network.chainId}\n`);
  } catch (error) {
    console.error("❌ Failed to connect to blockchain:", error.message);
    process.exit(1);
  }

  let counter = 0;

  // Main loop
  const interval = setInterval(async () => {
    try {
      counter++;
      
      // Get current block info before transaction
      const blockBefore = await provider.getBlock("latest");
      const timestampBefore = blockBefore.timestamp;
      
      // Send a minimal transaction (0 ETH self-transfer)
      const tx = await wallet.sendTransaction({
        to: wallet.address,
        value: 0,
        gasLimit: 21000,
      });
      
      // Wait for transaction to be mined
      await tx.wait();
      
      // Get new block info
      const blockAfter = await provider.getBlock("latest");
      const timestampAfter = blockAfter.timestamp;
      
      const timeDiff = timestampAfter - timestampBefore;
      
      console.log(
        `⛏️  Block #${counter} mined | ` +
        `Time: ${new Date(timestampAfter * 1000).toLocaleTimeString()} | ` +
        `+${timeDiff}s | ` +
        `Block: ${blockAfter.number}`
      );
      
    } catch (error) {
      console.error(`❌ Error mining block #${counter}:`, error.message);
      
      // If we get repeated errors, exit
      if (error.message.includes("ECONNREFUSED") || error.message.includes("network")) {
        console.error("\n🚨 Lost connection to blockchain. Exiting...");
        clearInterval(interval);
        process.exit(1);
      }
    }
  }, INTERVAL_MS);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n🛑 Stopping Keep Blockchain Alive Script");
    console.log(`📊 Total blocks mined: ${counter}`);
    clearInterval(interval);
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

