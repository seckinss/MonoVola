// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/MockUSDC.sol";

/**
 * @notice Deploy script for MockUSDC token
 * @dev Simple deployment script to deploy MockUSDC for testing on Monad
 * Example:
 * yarn deploy --file DeployMockUSDC.s.sol --network monadTestnet
 */
contract DeployMockUSDC is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // Deploy MockUSDC (mints 1M USDC to deployer)
        MockUSDC mockUsdc = new MockUSDC();
        
        console.log("====================================");
        console.log("MockUSDC deployed at:", address(mockUsdc));
        console.log("Deployer address:", deployer);
        console.log("Deployer USDC balance:", mockUsdc.balanceOf(deployer));
        console.log("Total supply:", mockUsdc.totalSupply());
        console.log("====================================");
        
        // Register the contract for export
        deployments.push(
            Deployment({name: "MockUSDC", addr: address(mockUsdc)})
        );
        
        console.log("");
        console.log("Next steps:");
        console.log("1. Save this address for quoteToken in main deployment");
        console.log("2. Anyone can mint more tokens: mockUsdc.mint(address, amount)");
        console.log("3. Use this address in DeployYourContract.s.sol for quoteToken");
    }
}

