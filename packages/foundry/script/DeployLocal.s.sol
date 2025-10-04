// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/HourlyVolatilityParimutuel.sol";
import "../contracts/MockUSDC.sol";
import "../contracts/MockUniswapV3Pool.sol";

/**
 * @notice Local testing deployment script with mock tokens and pools
 * @dev For local anvil chain testing only - deploys mock contracts
 * @dev FAST DEMO MODE: 90-second cycles (30 sec bet + 60 sec predict)
 * Example:
 * yarn deploy --file DeployLocal.s.sol  # local anvil chain
 */
contract DeployLocal is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // ╔══════════════════════════════════════════════════════════════════════╗
        // ║  LOCAL TESTING CONFIGURATION (Deploy Mock Contracts)                ║
        // ╚══════════════════════════════════════════════════════════════════════╝
        
        // Deploy mock USDC token (1M USDC minted to deployer)
        MockUSDC mockUsdc = new MockUSDC();
        console.log("MockUSDC deployed at:", address(mockUsdc));
        console.log("Deployer USDC balance:", mockUsdc.balanceOf(deployer));
        
        // Deploy mock Uniswap V3 pools
        MockUniswapV3Pool poolWethUsdc = new MockUniswapV3Pool();
        MockUniswapV3Pool poolWmonUsdc = new MockUniswapV3Pool();
        console.log("Mock WETH/USDC pool deployed at:", address(poolWethUsdc));
        console.log("Mock WMON/USDC pool deployed at:", address(poolWmonUsdc));
        
        address quoteToken = address(mockUsdc);
        address poolWethUsdcAddr = address(poolWethUsdc);
        address poolWmonUsdcAddr = address(poolWmonUsdc);
        
        // Timing parameters (FAST DEMO: 90-second cycles)
        uint32 stepSeconds = 30; // 30 seconds → 2 samples in 60-sec prediction window
        uint32 finalityDelaySeconds = 10; // 10 seconds safety delay after cycle ends
        uint32 resolveDeadlineSeconds = 1 hours; // 1 hour max to resolve before void
        
        // Fee parameters (total fees = 0.30%)
        address treasury = deployer; // Protocol treasury
        uint16 keeperBountyBps = 10; // 0.10% keeper bounty
        uint16 protocolFeeBps = 20; // 0.20% protocol fee
        
        // Oracle parameters
        uint16 minObservationCardinality = 5; // Minimum 5 observations (enough for 2 samples)
        
        // Deploy the Uniswap V3 Oracle variant
        HourlyVolatilityParimutuel market = new HourlyVolatilityParimutuel(
            quoteToken,
            poolWethUsdcAddr,
            poolWmonUsdcAddr,
            stepSeconds,
            finalityDelaySeconds,
            resolveDeadlineSeconds,
            treasury,
            keeperBountyBps,
            protocolFeeBps,
            minObservationCardinality
        );
        
        // Register contracts for export
        deployments.push(
            Deployment({name: "HourlyVolatilityParimutuel", addr: address(market)})
        );
        deployments.push(
            Deployment({name: "MockUSDC", addr: address(mockUsdc)})
        );
        
        console.log("HourlyVolatilityParimutuel deployed at:", address(market));
        console.log("Current cycle index:", market.currentCycleIndex());
        
        // Ensure pools have sufficient observation cardinality
        market.ensureObservationCardinality();
        console.log("Observation cardinality ensured");
        
        // ℹ️ FAST DEMO MODE: 90-second cycles
        // - 30 seconds betting phase
        // - 60 seconds prediction phase
        // - 10 seconds finality delay
        
        console.log("");
        console.log("=== TESTING SETUP ===");
        console.log("1. Get test USDC: mockUsdc.mint(YOUR_ADDRESS, 10000 * 10**6)");
        console.log("2. Approve contract: mockUsdc.approve(marketAddress, type(uint256).max)");
        console.log("3. Place bet: market.stakeYes(currentCycle, amount) or stakeNo(...)");
        console.log("");
        console.log("Mock USDC has public mint() - anyone can mint tokens for testing!");
    }
}

