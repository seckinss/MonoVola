// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/HourlyVolatilityParimutuel.sol";

/**
 * @notice Deploy script for HourlyVolatilityParimutuelChainlink contract (Chainlink variant)
 * @dev This variant uses Chainlink price feeds instead of Uniswap V3 pools
 * Example:
 * yarn deploy --file DeployChainlinkVariant.s.sol  # local anvil chain
 * yarn deploy --file DeployChainlinkVariant.s.sol --network monad # Monad testnet
 */
contract DeployChainlinkVariant is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // ╔══════════════════════════════════════════════════════════════════════╗
        // ║  CHAINLINK VARIANT CONFIGURATION                                    ║
        // ╚══════════════════════════════════════════════════════════════════════╝
        
        // Monad Testnet Token Addresses
        address quoteToken = 0xf817257fed379853cDe0fa4F97AB987181B1E5Ea; // USDC on Monad testnet
        
        // ⚠️ IMPORTANT: Check if Chainlink feeds are available on Monad testnet
        // Visit: https://docs.chain.link/data-feeds/price-feeds/addresses
        // If Chainlink isn't available on Monad, use the Uniswap V3 variant instead
        
        address aggEthUsd = address(0); // ⚠️ REPLACE: Chainlink ETH/USD aggregator
        address aggMonUsd = address(0); // ⚠️ REPLACE: Chainlink MON/USD aggregator
        
        // Timing parameters (optimized for hourly cycles with snapshots)
        uint32 stepSeconds = 300; // 5 minutes (theoretical step for calculation)
        uint32 finalityDelaySeconds = 120; // 2 minutes safety delay after cycle ends
        uint32 resolveDeadlineSeconds = 24 hours; // 24 hours max to resolve before void
        uint32 minSnapshotGap = 300; // 5 minutes minimum between snapshots
        uint32 maxStaleness = 300; // 5 minutes max staleness for Chainlink feeds
        
        // Fee parameters (total fees = 0.30%)
        address treasury = deployer; // Protocol treasury (set to deployer for testing)
        uint16 keeperBountyBps = 10; // 0.10% keeper bounty for calling resolve()
        uint16 protocolFeeBps = 20; // 0.20% protocol fee
        
        // Validate Chainlink feed addresses before deployment
        require(aggEthUsd != address(0), "aggEthUsd not set - check Chainlink availability on Monad");
        require(aggMonUsd != address(0), "aggMonUsd not set - check Chainlink availability on Monad");
        
        // Deploy the Chainlink variant
        HourlyVolatilityParimutuelChainlink chainlinkMarket = new HourlyVolatilityParimutuelChainlink(
            quoteToken,
            aggEthUsd,
            aggMonUsd,
            stepSeconds,
            finalityDelaySeconds,
            resolveDeadlineSeconds,
            minSnapshotGap,
            maxStaleness,
            treasury,
            keeperBountyBps,
            protocolFeeBps
        );
        
        // Register the contract for export
        deployments.push(
            Deployment({name: "HourlyVolatilityParimutuelChainlink", addr: address(chainlinkMarket)})
        );
        
        // ℹ️ After deployment:
        // 1. Get current cycle with currentCycleIndex()
        // 2. During the 50-minute prediction phase, keepers call snapshot(cycle) every 5-10 minutes
        // 3. Users can stake with stakeYes(cycle, amount) or stakeNo(cycle, amount) during subscription phase
        // 4. After cycle ends + finality delay, anyone can call resolve(cycle) to settle
        
        // ⚠️ NOTE: Chainlink feeds may not be available on Monad testnet yet.
        // If you get errors, use the Uniswap V3 variant (DeployYourContract.s.sol) instead.
    }
}

