// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/HourlyVolatilityParimutuel.sol";

/**
 * @notice Deploy script for HourlyVolatilityParimutuel contract
 * @dev Inherits ScaffoldETHDeploy which:
 *      - Includes forge-std/Script.sol for deployment
 *      - Includes ScaffoldEthDeployerRunner modifier
 *      - Provides `deployer` variable
 * Example:
 * yarn deploy --file DeployYourContract.s.sol  # local anvil chain
 * yarn deploy --file DeployYourContract.s.sol --network optimism # live network (requires keystore)
 */
contract DeployYourContract is ScaffoldETHDeploy {
    /**
     * @dev Deployer setup based on `ETH_KEYSTORE_ACCOUNT` in `.env`:
     *      - "scaffold-eth-default": Uses Anvil's account #9 (0xa0Ee7A142d267C1f36714E4a8F75612F20a79720), no password prompt
     *      - "scaffold-eth-custom": requires password used while creating keystore
     *
     * Note: Must use ScaffoldEthDeployerRunner modifier to:
     *      - Setup correct `deployer` account and fund it
     *      - Export contract addresses & ABIs to `nextjs` packages
     */
    function run() external ScaffoldEthDeployerRunner {
        // ╔══════════════════════════════════════════════════════════════════════╗
        // ║  MONAD TESTNET CONFIGURATION                                        ║
        // ╚══════════════════════════════════════════════════════════════════════╝
        
        // Monad Testnet Token Addresses
        address quoteToken = 0x9CcEa80798D86Cf988f37B419146E0158866096A; // USDC on Monad testnet
        // address weth = 0xB5a30b0FDc42e3E9760Cb8449Fb37; // WETH on Monad testnet
        // address wmon = 0xcf5a6076cfa32686c0Df13aBaDa2b40dec133F1d; // WMON on Monad testnet
        
        // ⚠️ IMPORTANT: Find Uniswap V3 pool addresses for your network
        // Option 1: Use Uniswap V3 Factory (0x961235a9020b05c44df1026d956d1f4d78014276) to find pool addresses
        // Option 2: Check block explorer for existing pools
        // Option 3: Deploy your own test pools for development
        // Option 4: Use the Chainlink variant instead (HourlyVolatilityParimutuelChainlink)
        
        address poolWethUsdc = 0xe8781Dc41A694c6877449CEFB27cc2C0Ae9D5dbc; // ⚠️ REPLACE: WETH/USDC Uniswap V3 pool
        address poolWMONUsdc = 0x7C2253A768E4AA90AFA9f9F246D8728064ee4c42; // ⚠️ REPLACE: WMON/USDC Uniswap V3 pool
        
        // If you don't have Uniswap V3 pools, consider using HourlyVolatilityParimutuelChainlink
        // which uses Chainlink price feeds instead of Uniswap pools
        
        // Timing parameters (optimized for hourly cycles)
        uint32 stepSeconds = 300; // 5 minutes → 10 samples in 50-min prediction window
        uint32 finalityDelaySeconds = 120; // 2 minutes safety delay after cycle ends
        uint32 resolveDeadlineSeconds = 24 hours; // 24 hours max to resolve before void (prevents stale observations)
        
        // Fee parameters (total fees = 0.30%)
        address treasury = deployer; // Protocol treasury (set to deployer for testing)
        uint16 keeperBountyBps = 10; // 0.10% keeper bounty for calling resolve()
        uint16 protocolFeeBps = 20; // 0.20% protocol fee
        
        // Oracle parameters
        uint16 minObservationCardinality = 32; // Minimum 32 observations (safe for 10 samples)
        
        // Validate pool addresses before deployment
        require(poolWethUsdc != address(0), "poolWethUsdc not set");
        require(poolWMONUsdc != address(0), "poolWMONUsdc not set");
        
        // Deploy the Uniswap V3 Oracle variant
        HourlyVolatilityParimutuel hourlyMarket = new HourlyVolatilityParimutuel(
            quoteToken,
            poolWethUsdc,
            poolWMONUsdc,
            stepSeconds,
            finalityDelaySeconds,
            resolveDeadlineSeconds,
            treasury,
            keeperBountyBps,
            protocolFeeBps,
            minObservationCardinality
        );
        
        // Register the contract for export
        deployments.push(
            Deployment({name: "HourlyVolatilityParimutuel", addr: address(hourlyMarket)})
        );
        
        // ℹ️ After deployment:
        // 1. Call ensureObservationCardinality() to set up the pools
        // 2. Get current cycle with currentCycleIndex()
        // 3. Users can stake with stakeYes(cycle, amount) or stakeNo(cycle, amount)
        // 4. After cycle ends, anyone can call resolve(cycle) to settle
    }
}
