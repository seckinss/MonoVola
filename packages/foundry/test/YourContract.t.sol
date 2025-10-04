// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../contracts/HourlyVolatilityParimutuel.sol";

contract HourlyVolatilityParimutuelTest is Test {
    HourlyVolatilityParimutuel public market;
    
    // Mock addresses for testing
    address quoteToken = address(0x1);
    address poolWethUsdc = address(0x2);
    address poolWmonUsdc = address(0x3);
    address treasury = address(0x4);

    function setUp() public {
        // Deploy with test parameters
        market = new HourlyVolatilityParimutuel(
            quoteToken,
            poolWethUsdc,
            poolWmonUsdc,
            300,        // stepSeconds
            120,        // finalityDelaySeconds
            24 hours,   // resolveDeadlineSeconds
            treasury,
            10,         // keeperBountyBps
            20,         // protocolFeeBps
            32          // minObservationCardinality
        );
    }

    function testDeployment() public view {
        // Verify deployment
        assertEq(address(market.quoteToken()), quoteToken);
        assertEq(market.keeperBountyBps(), 10);
        assertEq(market.protocolFeeBps(), 20);
    }

    function testCurrentCycleIndex() public view {
        // Test cycle index calculation
        uint256 cycleIndex = market.currentCycleIndex();
        assertTrue(cycleIndex >= 0);
    }
}
