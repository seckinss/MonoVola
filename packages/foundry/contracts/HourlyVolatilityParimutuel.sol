// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Monad On-Chain Hourly Volatility Prediction Market (Parimutuel)
 *
 * Goal: A fully on-chain, oracle-less (no off-chain data) hourly prediction market
 * that settles by comparing 50-minute realized volatility proxies for ETH and MON
 * using Uniswap V3 pool observations (WETH/USDC and WMON/USDC) — but works on any
 * EVM-compatible chain that supports Uniswap V3-like pools with observe().
 *
 * Design:
 *  - One contract manages infinite hourly "cycles" (no deploys needed).
 *  - Each cycle: 10 min subscription → 50 min prediction → resolution (total 60 min).
 *  - Users commit a quote ERC20 (e.g., USDC) to either side (YES = ETH more volatile, NO = MON more volatile).
 *  - Parimutuel payout: winners share the entire pot pro-rata. (No internal AMM; simple & gas-efficient.)
 *  - Settlement reads both pools' cumulative ticks for a 50-min window (split in STEP intervals) and compares
 *    sum of squared tick differences (Δtick^2) as a log-price volatility proxy.
 *  - Anyone may resolve after the cycle ends + FINALITY_DELAY. A keeper bounty (bps) is paid to the resolver from the pot.
 *  - Optional: increase pool observation cardinality to ensure historical samples are available.
 *
 * IMPORTANT: This is a production-leaning reference with careful naming, events, and guards; however, you MUST:
 *  - Audit prior to mainnet use;
 *  - Validate pool addresses, fee tiers, and adequate liquidity;
 *  - Tune STEP, FINALITY_DELAY, cardinality, and bounties reasonably for your chain;
 *  - Consider pausing/emergency paths for unexpected Uniswap behavior.
 */

/* ──────────────────────────────────────────────────────────────────────────────
 *                               Minimal Interfaces
 * ────────────────────────────────────────────────────────────────────────────── */

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

interface IUniswapV3Pool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);

    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
}

/* ──────────────────────────────────────────────────────────────────────────────
 *                               Libraries / Guards
 * ────────────────────────────────────────────────────────────────────────────── */

library SafeERC20 {
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        require(token.transferFrom(from, to, value), "SAFE/transferFrom");
    }
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        require(token.transfer(to, value), "SAFE/transfer");
    }
}

abstract contract ReentrancyGuard {
    uint256 private _entered;
    modifier nonReentrant() {
        require(_entered == 0, "REENTRANCY");
        _entered = 1;
        _;
        _entered = 0;
    }
}

/* ──────────────────────────────────────────────────────────────────────────────
 *                                    Contract
 * ────────────────────────────────────────────────────────────────────────────── */

contract HourlyVolatilityParimutuel is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ╔══════════════════════════════════════════════════════════════════════╗
       ║                               Errors                                ║
       ╚══════════════════════════════════════════════════════════════════════╝ */
    error InvalidParams();
    error TooEarly();
    error AlreadyResolved();
    error CycleEnded();
    error ZeroAmount();
    error NothingToClaim();
    error ObservationFailed();

    /* ╔══════════════════════════════════════════════════════════════════════╗
       ║                             Configuration                           ║
       ╚══════════════════════════════════════════════════════════════════════╝ */

    /// @notice Quote token used for staking and payouts (e.g., USDC)
    IERC20 public immutable quoteToken;

    /// @notice Uniswap V3 pools for price inference (must be deep-liquidity pools)
    IUniswapV3Pool public immutable poolWETH_USDC;
    IUniswapV3Pool public immutable poolWMON_USDC;

    /// @notice Subscription phase duration (users can stake during this period)
    uint32 public constant SUBSCRIPTION_WINDOW = 30 seconds; // 30 seconds (FAST DEMO)

    /// @notice Prediction phase duration (1 minute for volatility measurement)
    uint32 public constant PREDICTION_WINDOW = 60 seconds; // 60 seconds (FAST DEMO)

    /// @notice Total cycle length (subscription + prediction)
    uint32 public constant CYCLE_DURATION = 90 seconds; // 90 seconds (FAST DEMO)

    /// @notice Sampling step inside prediction window; e.g., 300 (5min) or 600 (10min). Must divide PREDICTION_WINDOW.
    uint32 public immutable stepSeconds; // e.g., 300 (5min)

    /// @notice Reorg/timestamp safety margin after cycle end before resolution allowed
    uint32 public immutable finalityDelaySeconds; // e.g., 120 (2min)

    /// @notice Maximum time after cycle end to resolve before round is voided (prevents stale observations)
    uint32 public immutable resolveDeadlineSeconds; // e.g., 24 hours

    /// @notice Optional protocol treasury to receive a small fee (bps)
    address public immutable treasury;

    /// @notice Keeper bounty in basis points, paid from the total pool at resolution
    uint16 public immutable keeperBountyBps; // e.g., 10 = 0.10%

    /// @notice Protocol fee in basis points, paid to treasury at resolution
    uint16 public immutable protocolFeeBps; // e.g., 20 = 0.20%

    /// @notice Maximum of bounty + fee in bps (1% default budget suggested)
    uint16 public constant MAX_FEE_BPS = 100; // 1.00%

    /// @notice Minimum observation cardinality to reliably sample the prediction window
    uint16 public immutable minObservationCardinality; // e.g., 32

    /* ╔══════════════════════════════════════════════════════════════════════╗
       ║                               Storage                                ║
       ╚══════════════════════════════════════════════════════════════════════╝ */

    /// @notice Per-cycle round info
    struct Round {
        uint64 startTs;           // cycle start timestamp (subscription phase begins)
        uint64 subscriptionEndTs; // subscription phase ends (prediction phase begins)
        uint64 endTs;             // cycle end timestamp (prediction phase ends)
        bool resolved;            // true after resolution
        bool voided;              // true if round is voided (refunds instead of payouts)
        bool ethMoreVolatile;     // winning side: true => ETH; false => MON
        uint256 ethMetric;        // Σ (Δtick_eth)^2
        uint256 monMetric;        // Σ (Δtick_mon)^2
        uint256 totalYes;         // total stake on ETH-more-volatile side
        uint256 totalNo;          // total stake on MON-more-volatile side
        uint256 bountyPaid;       // keeper bounty paid out at resolve
        uint256 protocolPaid;     // protocol fee paid at resolve
    }

    /// @dev cycleIndex => Round
    mapping(uint256 => Round) public rounds;

    /// @dev user stakes: cycleIndex => account => amount
    mapping(uint256 => mapping(address => uint256)) public userYes; // stake to YES (ETH)
    mapping(uint256 => mapping(address => uint256)) public userNo;  // stake to NO (MON)

    /// @dev user claim flags to avoid double-claim: cycleIndex => account => claimed?
    mapping(uint256 => mapping(address => bool)) public userClaimed;

    /// @notice Total amount wagered by each user across all cycles
    mapping(address => uint256) public totalWagered;

    /// @notice Total amount won by each user across all cycles
    mapping(address => uint256) public totalWon;

    /// @notice Global total volume across all rounds
    uint256 public totalVolume;

    /// @notice Total number of rounds resolved
    uint256 public totalRoundsResolved;

    /// @notice Number of rounds each user has participated in
    mapping(address => uint256) public userRoundsPlayed;

    /// @notice Number of rounds each user has won
    mapping(address => uint256) public userRoundsWon;

    /* ╔══════════════════════════════════════════════════════════════════════╗
       ║                                 Events                               ║
       ╚══════════════════════════════════════════════════════════════════════╝ */

    event CycleInitialized(uint256 indexed cycle, uint64 startTs, uint64 subscriptionEndTs, uint64 endTs);
    event StakePlaced(uint256 indexed cycle, address indexed user, bool yesSide, uint256 amount);
    event StakeCanceled(uint256 indexed cycle, address indexed user, bool yesSide, uint256 amount);
    event CycleResolved(
        uint256 indexed cycle,
        bool voided,
        bool ethMoreVolatile,
        uint256 ethMetric,
        uint256 monMetric,
        uint256 bountyPaid,
        uint256 protocolFeePaid
    );
    event Claimed(uint256 indexed cycle, address indexed user, uint256 payout);

    /* ╔══════════════════════════════════════════════════════════════════════╗
       ║                               Constructor                           ║
       ╚══════════════════════════════════════════════════════════════════════╝ */

    constructor(
        address _quoteToken,
        address _poolWethUsdc,
        address _poolWmonUsdc,
        uint32  _stepSeconds,
        uint32  _finalityDelaySeconds,
        uint32  _resolveDeadlineSeconds,
        address _treasury,
        uint16  _keeperBountyBps,
        uint16  _protocolFeeBps,
        uint16  _minObservationCardinality
    ) {
        if (
            _quoteToken == address(0) ||
            _poolWethUsdc == address(0) ||
            _poolWmonUsdc == address(0) ||
            _stepSeconds == 0 || _stepSeconds > PREDICTION_WINDOW ||
            PREDICTION_WINDOW % _stepSeconds != 0 ||
            _finalityDelaySeconds > 10 minutes ||
            _resolveDeadlineSeconds < 1 hours || _resolveDeadlineSeconds > 7 days ||
            (_keeperBountyBps + _protocolFeeBps) > MAX_FEE_BPS ||
            _minObservationCardinality < uint16((PREDICTION_WINDOW / _stepSeconds) + 1)
        ) revert InvalidParams();

        quoteToken = IERC20(_quoteToken);
        poolWETH_USDC = IUniswapV3Pool(_poolWethUsdc);
        poolWMON_USDC = IUniswapV3Pool(_poolWmonUsdc);
        stepSeconds = _stepSeconds;
        finalityDelaySeconds = _finalityDelaySeconds;
        resolveDeadlineSeconds = _resolveDeadlineSeconds;
        treasury = _treasury;
        keeperBountyBps = _keeperBountyBps;
        protocolFeeBps = _protocolFeeBps;
        minObservationCardinality = _minObservationCardinality;
    }

    /* ╔══════════════════════════════════════════════════════════════════════╗
       ║                             Public Helpers                           ║
       ╚══════════════════════════════════════════════════════════════════════╝ */

    function cycleIndexAt(uint256 ts) public pure returns (uint256) {
        return ts / CYCLE_DURATION;
    }

    function currentCycleIndex() public view returns (uint256) {
        return cycleIndexAt(block.timestamp);
    }

    function getOrInitRound(uint256 cycle) public returns (Round memory r) {
        r = rounds[cycle];
        if (r.startTs == 0) {
            uint64 startTs = uint64(cycle * CYCLE_DURATION);
            uint64 subscriptionEndTs = startTs + SUBSCRIPTION_WINDOW;
            uint64 endTs = startTs + CYCLE_DURATION;
            r = Round({
                startTs: startTs,
                subscriptionEndTs: subscriptionEndTs,
                endTs: endTs,
                resolved: false,
                voided: false,
                ethMoreVolatile: false,
                ethMetric: 0,
                monMetric: 0,
                totalYes: 0,
                totalNo: 0,
                bountyPaid: 0,
                protocolPaid: 0
            });
            rounds[cycle] = r;
            emit CycleInitialized(cycle, startTs, subscriptionEndTs, endTs);
        }
    }

    function getRound(uint256 cycle) external view returns (Round memory) {
        Round memory r = rounds[cycle];
        if (r.startTs == 0) {
            uint64 startTs = uint64(cycle * CYCLE_DURATION);
            uint64 subscriptionEndTs = startTs + SUBSCRIPTION_WINDOW;
            uint64 endTs = startTs + CYCLE_DURATION;
            r = Round({
                startTs: startTs,
                subscriptionEndTs: subscriptionEndTs,
                endTs: endTs,
                resolved: false,
                voided: false,
                ethMoreVolatile: false,
                ethMetric: 0,
                monMetric: 0,
                totalYes: 0,
                totalNo: 0,
                bountyPaid: 0,
                protocolPaid: 0
            });
        }
        return r;
    }

    /* ╔══════════════════════════════════════════════════════════════════════╗
       ║                        User Staking (Parimutuel)                     ║
       ╚══════════════════════════════════════════════════════════════════════╝ */

    /// @notice Stake quote tokens to YES (ETH more volatile) for a given cycle (only during subscription phase)
    function stakeYes(uint256 cycle, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Round memory r = getOrInitRound(cycle);
        if (block.timestamp >= r.subscriptionEndTs) revert CycleEnded();

        // Track statistics
        bool firstBetInCycle = (userYes[cycle][msg.sender] == 0 && userNo[cycle][msg.sender] == 0);
        
        userYes[cycle][msg.sender] += amount;
        rounds[cycle].totalYes += amount;
        
        totalWagered[msg.sender] += amount;
        totalVolume += amount;
        if (firstBetInCycle) {
            userRoundsPlayed[msg.sender]++;
        }
        
        SafeERC20.safeTransferFrom(quoteToken, msg.sender, address(this), amount);
        emit StakePlaced(cycle, msg.sender, true, amount);
    }

    /// @notice Stake quote tokens to NO (MON more volatile) for a given cycle (only during subscription phase)
    function stakeNo(uint256 cycle, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Round memory r = getOrInitRound(cycle);
        if (block.timestamp >= r.subscriptionEndTs) revert CycleEnded();

        // Track statistics
        bool firstBetInCycle = (userYes[cycle][msg.sender] == 0 && userNo[cycle][msg.sender] == 0);
        
        userNo[cycle][msg.sender] += amount;
        rounds[cycle].totalNo += amount;
        
        totalWagered[msg.sender] += amount;
        totalVolume += amount;
        if (firstBetInCycle) {
            userRoundsPlayed[msg.sender]++;
        }
        
        SafeERC20.safeTransferFrom(quoteToken, msg.sender, address(this), amount);
        emit StakePlaced(cycle, msg.sender, false, amount);
    }

    /// @notice Optional: Cancel stake before the subscription phase ends (quality-of-life)
    function cancelStake(uint256 cycle, bool yesSide, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Round memory r = getOrInitRound(cycle);
        if (block.timestamp >= r.subscriptionEndTs) revert CycleEnded();

        if (yesSide) {
            uint256 bal = userYes[cycle][msg.sender];
            require(bal >= amount, "insufficient");
            userYes[cycle][msg.sender] = bal - amount;
            rounds[cycle].totalYes -= amount;
        } else {
            uint256 bal = userNo[cycle][msg.sender];
            require(bal >= amount, "insufficient");
            userNo[cycle][msg.sender] = bal - amount;
            rounds[cycle].totalNo -= amount;
        }
        SafeERC20.safeTransfer(quoteToken, msg.sender, amount);
        emit StakeCanceled(cycle, msg.sender, yesSide, amount);
    }

    /* ╔══════════════════════════════════════════════════════════════════════╗
       ║                               Resolution                             ║
       ╚══════════════════════════════════════════════════════════════════════╝ */

    /// @notice Resolve a finished cycle; pays keeper bounty and protocol fee.
    /// @dev Measures volatility during the 50-minute prediction window (from subscriptionEndTs to endTs)
    function resolve(uint256 cycle) external nonReentrant {
        Round memory r = getOrInitRound(cycle);
        if (r.resolved) revert AlreadyResolved();
        if (block.timestamp < r.endTs + finalityDelaySeconds) revert TooEarly();

        // Check if resolve deadline has passed → void the round to prevent stale observations
        if (block.timestamp > r.endTs + finalityDelaySeconds + resolveDeadlineSeconds) {
            rounds[cycle].resolved = true;
            rounds[cycle].voided = true;
            emit CycleResolved(cycle, true, false, 0, 0, 0, 0);
            return;
        }

        // Build sampling schedule relative to NOW to cover the prediction window [subscriptionEndTs, endTs]
        uint256 n = uint256(PREDICTION_WINDOW) / uint256(stepSeconds); // e.g., 10 samples for 5-min steps
        require(n >= 2 && n <= 96, "bad-n");

        uint32[] memory secondsAgos = new uint32[](n + 1);
        uint256 offset = block.timestamp - uint256(r.endTs); // now - end
        for (uint256 i = 0; i <= n; i++) {
            secondsAgos[i] = uint32(offset + i * uint256(stepSeconds));
        }

        // Try to observe pool data; if it fails (e.g., observation buffer lost data), void the round
        int56[] memory ethTicksCum;
        int56[] memory monTicksCum;
        
        try poolWETH_USDC.observe(secondsAgos) returns (int56[] memory _ethTicksCum, uint160[] memory) {
            ethTicksCum = _ethTicksCum;
        } catch {
            rounds[cycle].resolved = true;
            rounds[cycle].voided = true;
            emit CycleResolved(cycle, true, false, 0, 0, 0, 0);
            return;
        }

        try poolWMON_USDC.observe(secondsAgos) returns (int56[] memory _monTicksCum, uint160[] memory) {
            monTicksCum = _monTicksCum;
        } catch {
            rounds[cycle].resolved = true;
            rounds[cycle].voided = true;
            emit CycleResolved(cycle, true, false, 0, 0, 0, 0);
            return;
        }

        uint256 ethMetric = _sumDeltaTickSquares(ethTicksCum, n, stepSeconds);
        uint256 monMetric = _sumDeltaTickSquares(monTicksCum, n, stepSeconds);

        bool ethMore = (ethMetric > monMetric);
        uint256 winnerTotal = ethMore ? r.totalYes : r.totalNo;

        // If no one bet on the winning side, void the round and allow refunds
        if (winnerTotal == 0) {
            rounds[cycle].resolved = true;
            rounds[cycle].voided = true;
            rounds[cycle].ethMoreVolatile = ethMore;
            rounds[cycle].ethMetric = ethMetric;
            rounds[cycle].monMetric = monMetric;
            emit CycleResolved(cycle, true, ethMore, ethMetric, monMetric, 0, 0);
            return;
        }

        // Normal resolution: set metrics and pay bounty/fee
        rounds[cycle].resolved = true;
        rounds[cycle].ethMoreVolatile = ethMore;
        rounds[cycle].ethMetric = ethMetric;
        rounds[cycle].monMetric = monMetric;

        // Calculate keeper bounty & protocol fee from the total pot
        uint256 pot = r.totalYes + r.totalNo;
        uint256 bounty = (pot * uint256(keeperBountyBps)) / 10_000;
        uint256 fee = treasury == address(0) ? 0 : (pot * uint256(protocolFeeBps)) / 10_000;

        if (bounty > 0) {
            rounds[cycle].bountyPaid = bounty;
            SafeERC20.safeTransfer(quoteToken, msg.sender, bounty);
        }
        if (fee > 0) {
            rounds[cycle].protocolPaid = fee;
            SafeERC20.safeTransfer(quoteToken, treasury, fee);
        }

        totalRoundsResolved++;

        emit CycleResolved(cycle, false, ethMore, ethMetric, monMetric, bounty, fee);
    }

    /// @notice Claim parimutuel payout after resolution (or refund if voided)
    function claim(uint256 cycle) external nonReentrant {
        Round memory r = rounds[cycle];
        if (!r.resolved) revert TooEarly();
        if (userClaimed[cycle][msg.sender]) revert NothingToClaim();

        userClaimed[cycle][msg.sender] = true;

        // If round is voided, refund the user's entire stake (both sides)
        if (r.voided) {
            uint256 stake = userYes[cycle][msg.sender] + userNo[cycle][msg.sender];
            require(stake > 0, "no-stake");
            userYes[cycle][msg.sender] = 0;
            userNo[cycle][msg.sender] = 0;
            SafeERC20.safeTransfer(quoteToken, msg.sender, stake);
            emit Claimed(cycle, msg.sender, stake);
            return;
        }

        // Normal payout: user must be on winning side
        uint256 userStake = r.ethMoreVolatile ? userYes[cycle][msg.sender] : userNo[cycle][msg.sender];
        require(userStake > 0, "no-win");

        uint256 pot = r.totalYes + r.totalNo;
        uint256 distributable = pot - r.bountyPaid - r.protocolPaid; // total available to winners
        uint256 winnerTotal = r.ethMoreVolatile ? r.totalYes : r.totalNo;

        // Payout = distributable * userStake / winnerTotal
        uint256 payout = (distributable * userStake) / winnerTotal;

        // Track statistics for wins
        totalWon[msg.sender] += payout;
        userRoundsWon[msg.sender]++;

        // Zero-out the user's stake to prevent double-claim accounting-wise
        if (r.ethMoreVolatile) {
            userYes[cycle][msg.sender] = 0;
        } else {
            userNo[cycle][msg.sender] = 0;
        }

        SafeERC20.safeTransfer(quoteToken, msg.sender, payout);
        emit Claimed(cycle, msg.sender, payout);
    }

    /* ╔══════════════════════════════════════════════════════════════════════╗
       ║                      Enhanced UX Functions                           ║
       ╚══════════════════════════════════════════════════════════════════════╝ */

    /// @notice Get the last N rounds (most recent cycles)
    /// @param count Number of recent rounds to fetch
    /// @return _rounds Array of Round structs
    /// @return cycleIds Array of cycle IDs corresponding to each round
    function getRecentRounds(uint256 count) 
        external 
        view 
        returns (Round[] memory _rounds, uint256[] memory cycleIds) 
    {
        uint256 current = currentCycleIndex();
        
        // Handle edge case where count > current cycle
        uint256 actualCount = count;
        if (current == 0) {
            actualCount = 1;
        } else if (count > current) {
            actualCount = current + 1;
        }
        
        _rounds = new Round[](actualCount);
        cycleIds = new uint256[](actualCount);
        
        // Fetch from oldest to newest within the range
        uint256 startCycle = current + 1 > actualCount ? current + 1 - actualCount : 0;
        
        for (uint256 i = 0; i < actualCount; i++) {
            uint256 cycleId = startCycle + i;
            cycleIds[i] = cycleId;
            Round memory r = rounds[cycleId];
            if (r.startTs == 0) {
                // Initialize round data for display
                uint64 startTs = uint64(cycleId * CYCLE_DURATION);
                uint64 subscriptionEndTs = startTs + SUBSCRIPTION_WINDOW;
                uint64 endTs = startTs + CYCLE_DURATION;
                _rounds[i] = Round({
                    startTs: startTs,
                    subscriptionEndTs: subscriptionEndTs,
                    endTs: endTs,
                    resolved: false,
                    voided: false,
                    ethMoreVolatile: false,
                    ethMetric: 0,
                    monMetric: 0,
                    totalYes: 0,
                    totalNo: 0,
                    bountyPaid: 0,
                    protocolPaid: 0
                });
            } else {
                _rounds[i] = r;
            }
        }
        
        return (_rounds, cycleIds);
    }

    /// @notice Get all claimable cycles for a user and their payout amounts
    /// @param user Address to check
    /// @param lookbackCycles How many past cycles to check (e.g., 100)
    /// @return claimableCycles Array of cycle IDs that user can claim
    /// @return amounts Payout amount for each claimable cycle
    function getClaimableRounds(address user, uint256 lookbackCycles) 
        external 
        view 
        returns (uint256[] memory claimableCycles, uint256[] memory amounts) 
    {
        uint256 current = currentCycleIndex();
        uint256 start = current > lookbackCycles ? current - lookbackCycles : 0;
        
        // First pass: count claimable rounds
        uint256 count = 0;
        for (uint256 i = start; i < current; i++) {
            if (_isClaimable(user, i)) {
                count++;
            }
        }
        
        // Allocate arrays
        claimableCycles = new uint256[](count);
        amounts = new uint256[](count);
        
        // Second pass: collect data
        uint256 idx = 0;
        for (uint256 i = start; i < current; i++) {
            if (_isClaimable(user, i)) {
                claimableCycles[idx] = i;
                amounts[idx] = _calculatePayout(user, i);
                idx++;
            }
        }
        
        return (claimableCycles, amounts);
    }

    /// @notice Claim payouts from multiple rounds in a single transaction
    /// @param cycles Array of cycle IDs to claim from
    function claimBatch(uint256[] calldata cycles) external nonReentrant {
        uint256 totalPayout = 0;
        
        for (uint256 i = 0; i < cycles.length; i++) {
            uint256 cycle = cycles[i];
            Round memory r = rounds[cycle];
            
            // Skip if not resolved or already claimed
            if (!r.resolved) continue;
            if (userClaimed[cycle][msg.sender]) continue;
            
            // Mark as claimed
            userClaimed[cycle][msg.sender] = true;
            
            // Handle voided rounds (refunds)
            if (r.voided) {
                uint256 stake = userYes[cycle][msg.sender] + userNo[cycle][msg.sender];
                if (stake > 0) {
                    userYes[cycle][msg.sender] = 0;
                    userNo[cycle][msg.sender] = 0;
                    totalPayout += stake;
                    emit Claimed(cycle, msg.sender, stake);
                }
            } 
            // Handle normal rounds (winnings)
            else {
                uint256 userStake = r.ethMoreVolatile 
                    ? userYes[cycle][msg.sender] 
                    : userNo[cycle][msg.sender];
                
                if (userStake > 0) {
                    uint256 pot = r.totalYes + r.totalNo;
                    uint256 distributable = pot - r.bountyPaid - r.protocolPaid;
                    uint256 winnerTotal = r.ethMoreVolatile ? r.totalYes : r.totalNo;
                    uint256 payout = (distributable * userStake) / winnerTotal;
                    
                    // Track statistics
                    totalWon[msg.sender] += payout;
                    userRoundsWon[msg.sender]++;
                    
                    totalPayout += payout;
                    emit Claimed(cycle, msg.sender, payout);
                }
            }
        }
        
        require(totalPayout > 0, "NothingToClaim");
        SafeERC20.safeTransfer(quoteToken, msg.sender, totalPayout);
    }

    /// @notice Get comprehensive statistics for a user
    /// @param user Address to get stats for
    /// @return wagered Total amount user has wagered
    /// @return won Total amount user has won
    /// @return profit Net profit (won - wagered), can be negative
    /// @return roundsPlayed Total rounds participated in
    /// @return roundsWon Total rounds won
    /// @return winRate Win rate percentage (basis points, e.g., 6500 = 65%)
    function getUserStats(address user) 
        external 
        view 
        returns (
            uint256 wagered,
            uint256 won,
            int256 profit,
            uint256 roundsPlayed,
            uint256 roundsWon,
            uint256 winRate
        ) 
    {
        wagered = totalWagered[user];
        won = totalWon[user];
        profit = int256(won) - int256(wagered);
        roundsPlayed = userRoundsPlayed[user];
        roundsWon = userRoundsWon[user];
        winRate = roundsPlayed > 0 ? (roundsWon * 10000) / roundsPlayed : 0;
        
        return (wagered, won, profit, roundsPlayed, roundsWon, winRate);
    }

    /// @notice Get global platform statistics
    function getGlobalStats() 
        external 
        view 
        returns (
            uint256 volume,
            uint256 roundsResolved,
            uint256 currentRound
        ) 
    {
        return (totalVolume, totalRoundsResolved, currentCycleIndex());
    }

    /// @notice Get user's positions across multiple cycles
    /// @param user Address to check
    /// @param cycles Array of cycle IDs to query
    /// @return yesStakes Amount user bet on YES for each cycle
    /// @return noStakes Amount user bet on NO for each cycle
    /// @return claimed Whether user has claimed from each cycle
    function getUserPositions(address user, uint256[] calldata cycles) 
        external 
        view 
        returns (
            uint256[] memory yesStakes,
            uint256[] memory noStakes,
            bool[] memory claimed
        ) 
    {
        yesStakes = new uint256[](cycles.length);
        noStakes = new uint256[](cycles.length);
        claimed = new bool[](cycles.length);
        
        for (uint256 i = 0; i < cycles.length; i++) {
            yesStakes[i] = userYes[cycles[i]][user];
            noStakes[i] = userNo[cycles[i]][user];
            claimed[i] = userClaimed[cycles[i]][user];
        }
        
        return (yesStakes, noStakes, claimed);
    }

    /// @notice Get multiple rounds at once
    /// @param cycles Array of cycle IDs to fetch
    /// @return _rounds Array of Round structs
    function getRounds(uint256[] calldata cycles) 
        external 
        view 
        returns (Round[] memory _rounds) 
    {
        _rounds = new Round[](cycles.length);
        for (uint256 i = 0; i < cycles.length; i++) {
            _rounds[i] = this.getRound(cycles[i]);
        }
        return _rounds;
    }

    /* ╔══════════════════════════════════════════════════════════════════════╗
       ║                          Pool Maintenance                            ║
       ╚══════════════════════════════════════════════════════════════════════╝ */

    /// @notice Ensure both pools have sufficient observation cardinality for the chosen sampling schedule.
    /// @dev Call this occasionally (anyone can) — recommended right after deployment and whenever STEP/window changes (not changeable here).
    function ensureObservationCardinality() external {
        poolWETH_USDC.increaseObservationCardinalityNext(minObservationCardinality);
        poolWMON_USDC.increaseObservationCardinalityNext(minObservationCardinality);
    }

    /* ╔══════════════════════════════════════════════════════════════════════╗
       ║                               Internal                               ║
       ╚══════════════════════════════════════════════════════════════════════╝ */

    function _sumDeltaTickSquares(
        int56[] memory ticksCum,
        uint256 n,
        uint32 step
    ) internal pure returns (uint256 sum) {
        // ticksCum length = n+1; Δtick_i = (ticksCum[i] - ticksCum[i-1]) / step
        for (uint256 i = 1; i <= n; i++) {
            int56 diff = ticksCum[i] - ticksCum[i - 1];
            int256 dt = int256(diff) / int256(uint256(step));
            int256 sq = dt * dt;
            sum += uint256(sq);
        }
    }

    /// @notice Internal helper: Check if a user can claim from a cycle
    function _isClaimable(address user, uint256 cycle) internal view returns (bool) {
        Round memory r = rounds[cycle];
        
        // Must be resolved and not already claimed
        if (!r.resolved || userClaimed[cycle][user]) {
            return false;
        }
        
        // If voided, anyone with a stake can claim refund
        if (r.voided) {
            return (userYes[cycle][user] + userNo[cycle][user]) > 0;
        }
        
        // Normal case: must be on winning side
        uint256 userStake = r.ethMoreVolatile ? userYes[cycle][user] : userNo[cycle][user];
        return userStake > 0;
    }

    /// @notice Internal helper: Calculate payout for a user in a cycle
    function _calculatePayout(address user, uint256 cycle) internal view returns (uint256) {
        Round memory r = rounds[cycle];
        
        // Voided round: refund entire stake
        if (r.voided) {
            return userYes[cycle][user] + userNo[cycle][user];
        }
        
        // Normal round: calculate parimutuel payout
        uint256 userStake = r.ethMoreVolatile ? userYes[cycle][user] : userNo[cycle][user];
        if (userStake == 0) return 0;
        
        uint256 pot = r.totalYes + r.totalNo;
        uint256 distributable = pot - r.bountyPaid - r.protocolPaid;
        uint256 winnerTotal = r.ethMoreVolatile ? r.totalYes : r.totalNo;
        
        return (distributable * userStake) / winnerTotal;
    }
}

/**
 * Deployment & Ops Notes (READ ME):
 *  - STEP: 300s (5min) or 600s (10min) are good defaults → n = 10 or 5 samples; set minObservationCardinality >= 11 or 6 (recommend 32).
 *  - FINALITY: 2–5 minutes delay is usually safe for hourly cycles.
 *  - Pools: choose deep-liquidity WETH/USDC and WMON/USDC pools on Monad (or chain-specific equivalents).
 *  - Treasury/Fees: set small fees (<= 1% combined with bounty) or zero for bootstrapping.
 *  - UX: Frontend can show: current cycle index, pot sizes (YES/NO), time left in subscription/prediction phase, expected payout, and resolver bounty.
 *  - Risk: very low-liquidity hours could degrade tick quality. Consider monitoring and pausing if necessary.
 *  - Fast-paced: Hourly cycles mean more engagement but require keepers to resolve promptly every hour.
 */


// -----------------------------------------------------------------------------
// Alternative Variant: Chainlink-based Hourly Volatility Parimutuel (ETH vs MON)
// -----------------------------------------------------------------------------
// NOTE:
// - This variant uses Chainlink Price Feeds (ETH/USD and MON/USD) instead of Uniswap V3 oracles.
// - It is *not* oracle-less: you trust Chainlink's decentralized oracle network.
// - It is portable to any EVM chain where Chainlink feeds exist (confirm support on Monad).
// - We snapshot prices during the 50-minute prediction phase (e.g., every 5-10 minutes) to build a realized-volatility proxy.
// - Snapshots can be triggered by anyone (keeper-friendly) and we pay a small bounty at resolve.

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

contract HourlyVolatilityParimutuelChainlink is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Config ──────────────────────────────────────────────────────────────
    IERC20 public immutable quoteToken;            // e.g., USDC
    AggregatorV3Interface public immutable aggEthUsd; // Chainlink ETH/USD
    AggregatorV3Interface public immutable aggMonUsd; // Chainlink MON/USD

    uint32  public constant SUBSCRIPTION_WINDOW = 30 seconds;  // 30 sec subscription phase (FAST DEMO)
    uint32  public constant PREDICTION_WINDOW = 60 seconds;    // 60 sec prediction phase (FAST DEMO)
    uint32  public constant CYCLE_DURATION = 90 seconds;       // 90 sec total cycle (FAST DEMO)
    uint32  public immutable stepSeconds;       // e.g., 300 (5min) or 600 (10min)
    uint32  public immutable finalityDelaySeconds; // e.g., 120 (2min)
    uint32  public immutable resolveDeadlineSeconds; // max time to resolve, e.g., 24 hours
    uint32  public immutable minSnapshotGap;    // minimum seconds between snapshots, e.g., 300 (5min)
    uint32  public immutable maxStaleness;      // max seconds since aggregator update, e.g., 300 (5min)

    address public immutable treasury;          // protocol fees sink (optional)
    uint16  public immutable keeperBountyBps;   // e.g., 10 (0.10%)
    uint16  public immutable protocolFeeBps;    // e.g., 20 (0.20%)
    uint16  public constant MAX_FEE_BPS = 100;  // cap 1%

    uint8   private immutable _decEth;          // decimals(ETH/USD)
    uint8   private immutable _decMon;          // decimals(MON/USD)

    // ── Storage ─────────────────────────────────────────────────────────────
    struct Round {
        uint64 startTs;
        uint64 subscriptionEndTs;  // subscription phase ends (prediction begins)
        uint64 endTs;
        bool   resolved;
        bool   voided;             // true if round is voided (refunds instead of payouts)
        bool   ethMoreVolatile;   // winner: true=ETH, false=MON
        uint256 ethMetric;         // Σ (Δp/p)^2 * 1e18 scale
        uint256 monMetric;         // Σ (Δp/p)^2 * 1e18 scale
        uint256 totalYes;          // stake on ETH side
        uint256 totalNo;           // stake on MON side
        uint256 bountyPaid;
        uint256 protocolPaid;
        uint32  lastSnapshotAt;    // last snapshot time (per-round)
        uint8   samples;           // number of stored samples
    }

    mapping(uint256 => Round) public rounds; // cycle => Round

    // We store samples in a ring buffer: cycle => index => (ethPrice, monPrice)
    struct Prices { int192 eth; int192 mon; }
    mapping(uint256 => mapping(uint8 => Prices)) private _prices; // up to 96 samples

    mapping(uint256 => mapping(address => uint256)) public userYes; // stakes
    mapping(uint256 => mapping(address => uint256)) public userNo;
    mapping(uint256 => mapping(address => bool))    public userClaimed;

    // ── Events ──────────────────────────────────────────────────────────────
    event CycleInitialized(uint256 indexed cycle, uint64 startTs, uint64 subscriptionEndTs, uint64 endTs);
    event SnapshotTaken(uint256 indexed cycle, uint8 index, int256 ethPrice, int256 monPrice);
    event StakePlaced(uint256 indexed cycle, address indexed user, bool yesSide, uint256 amount);
    event StakeCanceled(uint256 indexed cycle, address indexed user, bool yesSide, uint256 amount);
    event CycleResolved(uint256 indexed cycle, bool voided, bool ethMoreVolatile, uint256 ethMetric, uint256 monMetric, uint256 bounty, uint256 fee);
    event Claimed(uint256 indexed cycle, address indexed user, uint256 payout);

    // ── Errors ──────────────────────────────────────────────────────────────
    error InvalidParams();
    error TooEarly();
    error AlreadyResolved();
    error CycleEnded();
    error ZeroAmount();
    error NothingToClaim();
    error StaleFeed();
    error NotEnoughSamples();
    error SnapshotTooSoon();
    error SnapshotNotInPredictionPhase();

    constructor(
        address _quoteToken,
        address _aggEthUsd,
        address _aggMonUsd,
        uint32  _stepSeconds,
        uint32  _finalityDelaySeconds,
        uint32  _resolveDeadlineSeconds,
        uint32  _minSnapshotGap,
        uint32  _maxStaleness,
        address _treasury,
        uint16  _keeperBountyBps,
        uint16  _protocolFeeBps
    ) {
        if (
            _quoteToken == address(0) || _aggEthUsd == address(0) || _aggMonUsd == address(0) ||
            _stepSeconds == 0 || _stepSeconds > PREDICTION_WINDOW || PREDICTION_WINDOW % _stepSeconds != 0 ||
            _finalityDelaySeconds > 10 minutes ||
            _resolveDeadlineSeconds < 1 hours || _resolveDeadlineSeconds > 7 days ||
            (_keeperBountyBps + _protocolFeeBps) > MAX_FEE_BPS ||
            _minSnapshotGap == 0 || _minSnapshotGap > _stepSeconds ||
            _maxStaleness == 0 || _maxStaleness > 30 minutes
        ) revert InvalidParams();

        quoteToken = IERC20(_quoteToken);
        aggEthUsd = AggregatorV3Interface(_aggEthUsd);
        aggMonUsd = AggregatorV3Interface(_aggMonUsd);
        stepSeconds = _stepSeconds;
        finalityDelaySeconds = _finalityDelaySeconds;
        resolveDeadlineSeconds = _resolveDeadlineSeconds;
        minSnapshotGap = _minSnapshotGap;
        maxStaleness = _maxStaleness;
        treasury = _treasury;
        keeperBountyBps = _keeperBountyBps;
        protocolFeeBps = _protocolFeeBps;

        _decEth = aggEthUsd.decimals();
        _decMon = aggMonUsd.decimals();
    }

    // ── View helpers ────────────────────────────────────────────────────────
    function cycleIndexAt(uint256 ts) public pure returns (uint256) { return ts / CYCLE_DURATION; }
    function currentCycleIndex() public view returns (uint256) { return cycleIndexAt(block.timestamp); }

    function getOrInitRound(uint256 cycle) public returns (Round memory r) {
        r = rounds[cycle];
        if (r.startTs == 0) {
            uint64 startTs = uint64(cycle * CYCLE_DURATION);
            uint64 subscriptionEndTs = startTs + SUBSCRIPTION_WINDOW;
            uint64 endTs = startTs + CYCLE_DURATION;
            r = Round({
                startTs: startTs,
                subscriptionEndTs: subscriptionEndTs,
                endTs: endTs,
                resolved: false,
                voided: false,
                ethMoreVolatile: false,
                ethMetric: 0,
                monMetric: 0,
                totalYes: 0,
                totalNo: 0,
                bountyPaid: 0,
                protocolPaid: 0,
                lastSnapshotAt: 0,
                samples: 0
            });
            rounds[cycle] = r;
            emit CycleInitialized(cycle, startTs, subscriptionEndTs, endTs);
        }
    }

    function getRound(uint256 cycle) external view returns (Round memory) {
        Round memory r = rounds[cycle];
        if (r.startTs == 0) {
            uint64 startTs = uint64(cycle * CYCLE_DURATION);
            uint64 subscriptionEndTs = startTs + SUBSCRIPTION_WINDOW;
            uint64 endTs = startTs + CYCLE_DURATION;
            r = Round({
                startTs: startTs,
                subscriptionEndTs: subscriptionEndTs,
                endTs: endTs,
                resolved: false,
                voided: false,
                ethMoreVolatile: false,
                ethMetric: 0,
                monMetric: 0,
                totalYes: 0,
                totalNo: 0,
                bountyPaid: 0,
                protocolPaid: 0,
                lastSnapshotAt: 0,
                samples: 0
            });
        }
        return r;
    }

    // ── Staking ─────────────────────────────────────────────────────────────
    function stakeYes(uint256 cycle, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Round memory r = getOrInitRound(cycle);
        if (block.timestamp >= r.subscriptionEndTs) revert CycleEnded();
        userYes[cycle][msg.sender] += amount;
        rounds[cycle].totalYes += amount;
        SafeERC20.safeTransferFrom(quoteToken, msg.sender, address(this), amount);
        emit StakePlaced(cycle, msg.sender, true, amount);
    }

    function stakeNo(uint256 cycle, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Round memory r = getOrInitRound(cycle);
        if (block.timestamp >= r.subscriptionEndTs) revert CycleEnded();
        userNo[cycle][msg.sender] += amount;
        rounds[cycle].totalNo += amount;
        SafeERC20.safeTransferFrom(quoteToken, msg.sender, address(this), amount);
        emit StakePlaced(cycle, msg.sender, false, amount);
    }

    function cancelStake(uint256 cycle, bool yesSide, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Round memory r = getOrInitRound(cycle);
        if (block.timestamp >= r.subscriptionEndTs) revert CycleEnded();
        if (yesSide) {
            uint256 bal = userYes[cycle][msg.sender];
            require(bal >= amount, "insufficient");
            userYes[cycle][msg.sender] = bal - amount;
            rounds[cycle].totalYes -= amount;
        } else {
            uint256 bal = userNo[cycle][msg.sender];
            require(bal >= amount, "insufficient");
            userNo[cycle][msg.sender] = bal - amount;
            rounds[cycle].totalNo -= amount;
        }
        SafeERC20.safeTransfer(quoteToken, msg.sender, amount);
        emit StakeCanceled(cycle, msg.sender, yesSide, amount);
    }

    // ── Snapshots (anyone can call; keeper-friendly) ────────────────────────
    /// @notice Take a price snapshot during the prediction phase only
    function snapshot(uint256 cycle) external {
        Round memory r = getOrInitRound(cycle);
        // Only allow snapshots during prediction phase (after subscription ends, before cycle ends)
        if (block.timestamp < r.subscriptionEndTs || block.timestamp >= r.endTs) revert SnapshotNotInPredictionPhase();
        if (r.lastSnapshotAt != 0 && block.timestamp < uint256(r.lastSnapshotAt) + uint256(minSnapshotGap)) revert SnapshotTooSoon();

        (int256 pE, uint256 tE) = _readPriceFresh(aggEthUsd, _decEth);
        (int256 pB, uint256 tB) = _readPriceFresh(aggMonUsd, _decMon);
        // Align staleness by enforcing both are fresh relative to now
        if ((block.timestamp - tE) > maxStaleness || (block.timestamp - tB) > maxStaleness) revert StaleFeed();

        uint8 idx = rounds[cycle].samples;
        require(idx < 96, "too many samples");
        _prices[cycle][idx] = Prices({ eth: int192(pE), mon: int192(pB) });
        rounds[cycle].samples = idx + 1;
        rounds[cycle].lastSnapshotAt = uint32(block.timestamp);

        emit SnapshotTaken(cycle, idx, pE, pB);
    }

    function _readPriceFresh(AggregatorV3Interface agg, uint8 dec) internal view returns (int256 p, uint256 updatedAt) {
        (uint80 roundId, int256 answer, , uint256 updated, uint80 answeredInRound) = agg.latestRoundData();
        require(answeredInRound >= roundId, "incomplete");
        require(answer > 0, "bad price");
        p = _to1e18(answer, dec); // normalize to 1e18
        updatedAt = updated;
    }

    function _to1e18(int256 x, uint8 dec) internal pure returns (int256) {
        if (dec == 18) return x;
        if (dec < 18) return x * int256(10 ** uint256(18 - dec));
        return x / int256(10 ** uint256(dec - 18));
    }

    // ── Resolution ──────────────────────────────────────────────────────────
    function resolve(uint256 cycle) external nonReentrant {
        Round memory r = getOrInitRound(cycle);
        if (r.resolved) revert AlreadyResolved();
        if (block.timestamp < r.endTs + finalityDelaySeconds) revert TooEarly();

        // Check if resolve deadline has passed → void the round
        if (block.timestamp > r.endTs + finalityDelaySeconds + resolveDeadlineSeconds) {
            rounds[cycle].resolved = true;
            rounds[cycle].voided = true;
            emit CycleResolved(cycle, true, false, 0, 0, 0, 0);
            return;
        }

        // If insufficient snapshots, void the round and allow refunds (prevents fund locking)
        if (r.samples < 2) {
            rounds[cycle].resolved = true;
            rounds[cycle].voided = true;
            emit CycleResolved(cycle, true, false, 0, 0, 0, 0);
            return;
        }

        (uint256 ethMetric, uint256 monMetric) = _computeMetrics(cycle, r.samples);
        bool ethMore = (ethMetric > monMetric);
        uint256 winnerTotal = ethMore ? r.totalYes : r.totalNo;

        // If no one bet on the winning side, void the round and allow refunds
        if (winnerTotal == 0) {
            rounds[cycle].resolved = true;
            rounds[cycle].voided = true;
            rounds[cycle].ethMoreVolatile = ethMore;
            rounds[cycle].ethMetric = ethMetric;
            rounds[cycle].monMetric = monMetric;
            emit CycleResolved(cycle, true, ethMore, ethMetric, monMetric, 0, 0);
            return;
        }

        // Normal resolution: set metrics and pay bounty/fee
        rounds[cycle].resolved = true;
        rounds[cycle].ethMoreVolatile = ethMore;
        rounds[cycle].ethMetric = ethMetric;
        rounds[cycle].monMetric = monMetric;

        uint256 pot = r.totalYes + r.totalNo;
        uint256 bounty = (pot * uint256(keeperBountyBps)) / 10_000;
        uint256 fee = treasury == address(0) ? 0 : (pot * uint256(protocolFeeBps)) / 10_000;

        if (bounty > 0) { rounds[cycle].bountyPaid = bounty; SafeERC20.safeTransfer(quoteToken, msg.sender, bounty); }
        if (fee > 0)    { rounds[cycle].protocolPaid = fee; SafeERC20.safeTransfer(quoteToken, treasury, fee); }

        emit CycleResolved(cycle, false, ethMore, ethMetric, monMetric, bounty, fee);
    }

    function _computeMetrics(uint256 cycle, uint8 n) internal view returns (uint256 ethSumSq, uint256 monSumSq) {
        // realized variance proxy: sum of (Δp/p)^2 between snapshots; both scaled to 1e18
        Prices memory prev = _prices[cycle][0];
        for (uint8 i = 1; i < n; i++) {
            Prices memory cur = _prices[cycle][i];
            // Δp/p scaled: ((p_i - p_{i-1}) * 1e18) / p_{i-1}
            int256 dEth = ((int256(cur.eth) - int256(prev.eth)) * 1e18) / int256(prev.eth);
            int256 dMon = ((int256(cur.mon) - int256(prev.mon)) * 1e18) / int256(prev.mon);
            uint256 sEth = _sq1e18(dEth);
            uint256 sMon = _sq1e18(dMon);
            ethSumSq += sEth;
            monSumSq += sMon;
            prev = cur;
        }
    }

    function _sq1e18(int256 x) internal pure returns (uint256) {
        if (x < 0) x = -x; // square, sign irrelevant
        return uint256((x * x) / 1e18);
    }

    // ── Claim ───────────────────────────────────────────────────────────────
    function claim(uint256 cycle) external nonReentrant {
        Round memory r = rounds[cycle];
        if (!r.resolved) revert TooEarly();
        if (userClaimed[cycle][msg.sender]) revert NothingToClaim();

        userClaimed[cycle][msg.sender] = true;

        // If round is voided, refund the user's entire stake (both sides)
        if (r.voided) {
            uint256 stake = userYes[cycle][msg.sender] + userNo[cycle][msg.sender];
            require(stake > 0, "no-stake");
            userYes[cycle][msg.sender] = 0;
            userNo[cycle][msg.sender] = 0;
            SafeERC20.safeTransfer(quoteToken, msg.sender, stake);
            emit Claimed(cycle, msg.sender, stake);
            return;
        }

        // Normal payout: user must be on winning side
        uint256 userStake = r.ethMoreVolatile ? userYes[cycle][msg.sender] : userNo[cycle][msg.sender];
        require(userStake > 0, "no-win");

        uint256 pot = r.totalYes + r.totalNo;
        uint256 distributable = pot - r.bountyPaid - r.protocolPaid;
        uint256 winnerTotal = r.ethMoreVolatile ? r.totalYes : r.totalNo;
        uint256 payout = (distributable * userStake) / winnerTotal;

        if (r.ethMoreVolatile) { userYes[cycle][msg.sender] = 0; } else { userNo[cycle][msg.sender] = 0; }
        SafeERC20.safeTransfer(quoteToken, msg.sender, payout);
        emit Claimed(cycle, msg.sender, payout);
    }
}

/**
 * Ops notes for Chainlink variant:
 *  - Confirm Chainlink ETH/USD and MON/USD feeds are live on your target chain (Monad). If not, this variant won't work.
 *  - Choose stepSeconds (e.g., 300 for 5min or 600 for 10min) and minSnapshotGap (e.g., 300) to bound gas while capturing enough dynamics.
 *  - Frontend/keepers should call snapshot() during the 50-minute prediction phase (every 5-10 minutes); resolution requires ≥2 samples.
 *  - maxStaleness ensures aggregator updates are recent (protects against halted feeds).
 *  - Using the same (Δp/p)^2 proxy for both assets keeps the comparison robust even if it's an approximation to log-returns.
 *  - Fast hourly cycles: Users have 10 minutes to bet, then 50 minutes for volatility measurement, then resolution happens promptly.
 */
