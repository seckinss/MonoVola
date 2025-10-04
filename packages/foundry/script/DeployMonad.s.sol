// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/HourlyVolatilityParimutuel.sol";
import "../contracts/MockUSDC.sol";

/**
 * @notice Complete deployment script for Monad Testnet
 * @dev Deploys HourlyVolatilityParimutuel using real Uniswap V3 pools
 * Example:
 * forge script script/DeployMonad.s.sol:DeployMonad --rpc-url monadTestnet --account deployer --broadcast --legacy -vvv
 */
contract DeployMonad is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        console.log("====================================");
        console.log("DEPLOYING TO MONAD TESTNET");
        console.log("====================================");
        console.log("");
        
        // ╔══════════════════════════════════════════════════════════════════════╗
        // ║  STEP 1: Deploy MockUSDC (if not already deployed)                  ║
        // ╚══════════════════════════════════════════════════════════════════════╝
        
        // Use your already deployed MockUSDC or deploy a new one
        address quoteToken = 0x9CcEa80798D86Cf988f37B419146E0158866096A; // Your deployed MockUSDC
        
        console.log("Using MockUSDC at:", quoteToken);
        console.log("");
        
        // ╔══════════════════════════════════════════════════════════════════════╗
        // ║  STEP 2: Use Real Uniswap V3 Pools on Monad Testnet                ║
        // ╚══════════════════════════════════════════════════════════════════════╝
        
        address poolWethUsdc = 0xe8781Dc41A694c6877449CEFB27cc2C0Ae9D5dbc; // Real WETH/USDC Uniswap V3 pool
        address poolWmonUsdc = 0x7C2253A768E4AA90AFA9f9F246D8728064ee4c42; // Real WMON/USDC Uniswap V3 pool
        
        console.log("Using WETH/USDC pool at:", poolWethUsdc);
        console.log("Using WMON/USDC pool at:", poolWmonUsdc);
        console.log("");
        
        // ╔══════════════════════════════════════════════════════════════════════╗
        // ║  STEP 3: Deploy HourlyVolatilityParimutuel                          ║
        // ╚══════════════════════════════════════════════════════════════════════╝
        
        // Timing parameters (FAST DEMO MODE: 180-second cycles)
        uint32 stepSeconds = 60; // 60 seconds → 2 samples in 120-sec prediction window
        uint32 finalityDelaySeconds = 5; // 5 seconds safety delay
        uint32 resolveDeadlineSeconds = 1 hours; // 1 hour max to resolve
        
        // Fee parameters (total fees = 0.30%)
        address treasury = deployer; // Protocol treasury
        uint16 keeperBountyBps = 10; // 0.10% keeper bounty
        uint16 protocolFeeBps = 20; // 0.20% protocol fee
        
        // Oracle parameters
        uint16 minObservationCardinality = 5; // Minimum 5 observations (enough for 2 samples)
        
        console.log("Deploying HourlyVolatilityParimutuel...");
        HourlyVolatilityParimutuel market = new HourlyVolatilityParimutuel(
            quoteToken,
            poolWethUsdc,
            poolWmonUsdc,
            stepSeconds,
            finalityDelaySeconds,
            resolveDeadlineSeconds,
            treasury,
            keeperBountyBps,
            protocolFeeBps,
            minObservationCardinality
        );
        
        console.log("HourlyVolatilityParimutuel deployed at:", address(market));
        console.log("");
        
        // ╔══════════════════════════════════════════════════════════════════════╗
        // ║  STEP 4: Initialize Observation Cardinality                         ║
        // ╚══════════════════════════════════════════════════════════════════════╝
        
        console.log("Ensuring observation cardinality...");
        market.ensureObservationCardinality();
        console.log("Observation cardinality ensured");
        console.log("");
        
        // ╔══════════════════════════════════════════════════════════════════════╗
        // ║  STEP 5: Register Contracts for Export                              ║
        // ╚══════════════════════════════════════════════════════════════════════╝
        
        deployments.push(
            Deployment({name: "MockUSDC", addr: quoteToken})
        );
        deployments.push(
            Deployment({name: "HourlyVolatilityParimutuel", addr: address(market)})
        );
        
        // ╔══════════════════════════════════════════════════════════════════════╗
        // ║  DEPLOYMENT SUMMARY                                                  ║
        // ╚══════════════════════════════════════════════════════════════════════╝
        
        console.log("====================================");
        console.log("DEPLOYMENT COMPLETE!");
        console.log("====================================");
        console.log("");
        console.log("Contract Addresses:");
        console.log("-----------------------------------");
        console.log("MockUSDC:                   ", quoteToken);
        console.log("WETH/USDC Pool (Uniswap V3):", poolWethUsdc);
        console.log("WMON/USDC Pool (Uniswap V3):", poolWmonUsdc);
        console.log("HourlyVolatilityParimutuel: ", address(market));
        console.log("-----------------------------------");
        console.log("");
        console.log("Configuration:");
        console.log("- Cycle Duration:     180 seconds (FAST DEMO)");
        console.log("- Betting Phase:      60 seconds");
        console.log("- Prediction Phase:   120 seconds");
        console.log("- Step Seconds:       60 seconds");
        console.log("- Finality Delay:     5 seconds");
        console.log("- Current Cycle:      ", market.currentCycleIndex());
        console.log("");
        console.log("Next Steps:");
        console.log("1. Update scaffold.config.ts to point to Monad testnet");
        console.log("2. Mint test USDC: MockUSDC.mint(yourAddress, amount)");
        console.log("3. Approve contract: MockUSDC.approve(marketAddress, maxUint)");
        console.log("4. Start betting!");
        console.log("");
    }
}

