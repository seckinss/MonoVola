// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice Mock Uniswap V3 Pool for local testing
 * @dev Simulates pool with fake tick data for volatility testing
 */
contract MockUniswapV3Pool {
    uint32 public observationCardinality;
    
    constructor() {
        observationCardinality = 100; // Start with enough observations
    }
    
    /**
     * @notice Returns mock tick cumulative data
     * @dev Generates semi-random tick data based on block timestamp
     */
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory liquidityCumulatives)
    {
        uint256 n = secondsAgos.length;
        tickCumulatives = new int56[](n);
        liquidityCumulatives = new uint160[](n);
        
        // Generate deterministic but varying tick data
        int56 baseTick = int56(int256(block.timestamp * 1000));
        
        for (uint256 i = 0; i < n; i++) {
            // Create tick cumulatives that increase over time
            // Add some variation based on secondsAgo to simulate price movement
            int256 variation = int256(uint256(keccak256(abi.encodePacked(block.timestamp, secondsAgos[i])))) % 1000;
            tickCumulatives[i] = baseTick - int56(int256(uint256(secondsAgos[i])) * 1000) + int56(variation);
            liquidityCumulatives[i] = uint160(block.timestamp);
        }
        
        return (tickCumulatives, liquidityCumulatives);
    }
    
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external {
        if (observationCardinalityNext > observationCardinality) {
            observationCardinality = uint32(observationCardinalityNext);
        }
    }
}

