# 📊 HourlyVolatilityParimutuel - Frontend Development Guide

## 🎯 Contract Overview

**What it does:** An hourly prediction market where users bet on whether **ETH** or **MON** will be more volatile. It's a **parimutuel system** (winners split the entire pot), running in infinite hourly cycles with no oracle fees.

**How it works:**
- **30-second subscription phase**: Users place bets (YES = ETH more volatile, NO = MON more volatile) - FAST DEMO
- **60-second prediction phase**: Volatility is measured using Uniswap V3 TWAP data - FAST DEMO
- **Resolution**: Anyone can trigger settlement and earn a bounty; winners claim payouts (10 sec delay)

---

## ⏱️ Cycle Timeline (180 seconds total - FAST DEMO MODE)

```
┌─────────┬───────────────────────────────┬─────────┐
│ 0-60sec │ 60sec-180sec                  │ 100sec+ │
│ BET     │ PREDICT (measure volatility)  │ RESOLVE │
│ Place   │ Wait for results              │ Claim   │
└─────────┴───────────────────────────────┴─────────┘
```

> ⚡ **FAST DEMO MODE**: Ultra-short 90-second cycles for quick demonstrations!

---

## 🔧 Key Configuration (Immutable)

### Constants
```typescript
SUBSCRIPTION_WINDOW = 30       // 30 seconds (FAST DEMO)
PREDICTION_WINDOW = 60         // 60 seconds (FAST DEMO)
CYCLE_DURATION = 90            // 90 seconds (FAST DEMO)
MAX_FEE_BPS = 100              // 1% max total fees
```

### Configurable (Set at deployment)
```typescript
quoteToken: address             // Token used for betting (e.g., USDC)
poolWETH_USDC: address          // Uniswap V3 WETH/USDC pool
poolWMON_USDC: address          // Uniswap V3 WMON/USDC pool
stepSeconds: uint32             // Sample interval (30 seconds) FAST DEMO
finalityDelaySeconds: uint32    // Safety delay (10 seconds) FAST DEMO
resolveDeadlineSeconds: uint32  // Max time to resolve (1 hour)
treasury: address               // Protocol fee recipient
keeperBountyBps: uint16         // Bounty for resolver (e.g., 10 = 0.1%)
protocolFeeBps: uint16          // Protocol fee (e.g., 20 = 0.2%)
minObservationCardinality: uint16 // Min samples needed (5 for demo)
```

---

## 📦 Round Struct (Core Data)

```typescript
struct Round {
  startTs: uint64              // Cycle start time (Unix timestamp)
  subscriptionEndTs: uint64    // When betting closes (start + 10 min)
  endTs: uint64                // When cycle ends (start + 60 min)
  resolved: boolean            // True after settlement
  voided: boolean              // True if round cancelled (refunds)
  ethMoreVolatile: boolean     // Winning side (true=ETH, false=MON)
  ethMetric: uint256           // ETH volatility score (sum of Δtick²)
  MONMetric: uint256           // MON volatility score (sum of Δtick²)
  totalYes: uint256            // Total bet on ETH (in USDC/quoteToken)
  totalNo: uint256             // Total bet on MON (in USDC/quoteToken)
  bountyPaid: uint256          // Keeper bounty amount
  protocolPaid: uint256        // Protocol fee amount
}
```

---

## 🎮 Main User Functions

### 1️⃣ **stakeYes(cycle, amount)** - Bet on ETH
```typescript
// Bet that ETH will be MORE volatile than MON
await writeContractAsync({
  functionName: "stakeYes",
  args: [cycleIndex, parseUnits("100", 6)], // 100 USDC (6 decimals)
});
```
- ⏰ **Only during subscription window** (first 30 seconds - FAST DEMO)
- 💰 Requires USDC approval first
- ✅ Emits `StakePlaced(cycle, user, true, amount)`

### 2️⃣ **stakeNo(cycle, amount)** - Bet on MON
```typescript
// Bet that MON will be MORE volatile than ETH
await writeContractAsync({
  functionName: "stakeNo",
  args: [cycleIndex, parseUnits("100", 6)], // 100 USDC
});
```
- Same requirements as `stakeYes`
- ✅ Emits `StakePlaced(cycle, user, false, amount)`

### 3️⃣ **cancelStake(cycle, yesSide, amount)** - Undo Bet
```typescript
// Cancel your bet before subscription ends
await writeContractAsync({
  functionName: "cancelStake",
  args: [cycleIndex, true, parseUnits("50", 6)], // Cancel 50 USDC from YES
});
```
- ⏰ **Only during subscription window**
- Returns your tokens immediately

### 4️⃣ **resolve(cycle)** - Settle Round (Anyone can call)
```typescript
// Trigger settlement after cycle ends (earn bounty!)
await writeContractAsync({
  functionName: "resolve",
  args: [cycleIndex],
});
```
- ⏰ **Only after cycle ends + finality delay** (~100 seconds after start - FAST DEMO)
- 💰 Caller receives keeper bounty (0.1% of pot)
- ✅ Emits `CycleResolved(...)`

### 5️⃣ **claim(cycle)** - Claim Winnings
```typescript
// Claim your payout if you won
await writeContractAsync({
  functionName: "claim",
  args: [cycleIndex],
});
```
- ⏰ **Only after resolution**
- Winners get pro-rata share of (totalPot - fees - bounty)
- If voided, everyone gets refunds

---

## 👀 View Functions (Reading State)

### Get Current Cycle
```typescript
const { data: currentCycle } = useScaffoldReadContract({
  contractName: "HourlyVolatilityParimutuel",
  functionName: "currentCycleIndex",
});
// Returns: 123456 (current hourly cycle number)
```

### Get Round Info
```typescript
const { data: round } = useScaffoldReadContract({
  contractName: "HourlyVolatilityParimutuel",
  functionName: "getRound",
  args: [cycleIndex],
});
// Returns: Full Round struct with all data
```

### Get User's YES Stake
```typescript
const { data: yesStake } = useScaffoldReadContract({
  contractName: "HourlyVolatilityParimutuel",
  functionName: "userYes",
  args: [cycleIndex, userAddress],
});
// Returns: Amount user bet on YES (in wei/smallest unit)
```

### Get User's NO Stake
```typescript
const { data: noStake } = useScaffoldReadContract({
  contractName: "HourlyVolatilityParimutuel",
  functionName: "userNo",
  args: [cycleIndex, userAddress],
});
```

### Check if User Claimed
```typescript
const { data: hasClaimed } = useScaffoldReadContract({
  contractName: "HourlyVolatilityParimutuel",
  functionName: "userClaimed",
  args: [cycleIndex, userAddress],
});
// Returns: boolean
```

### Convert Timestamp to Cycle
```typescript
const { data: cycleAtTime } = useScaffoldReadContract({
  contractName: "HourlyVolatilityParimutuel",
  functionName: "cycleIndexAt",
  args: [timestamp],
});
```

---

## 📡 Events to Listen For

### `CycleInitialized`
```typescript
event CycleInitialized(
  uint256 indexed cycle,
  uint64 startTs,
  uint64 subscriptionEndTs,
  uint64 endTs
)
```

### `StakePlaced`
```typescript
event StakePlaced(
  uint256 indexed cycle,
  address indexed user,
  bool yesSide,        // true=YES/ETH, false=NO/MON
  uint256 amount
)
```

### `CycleResolved`
```typescript
event CycleResolved(
  uint256 indexed cycle,
  bool voided,           // true if cancelled
  bool ethMoreVolatile,  // winning side
  uint256 ethMetric,     // ETH volatility score
  uint256 MONMetric,     // MON volatility score
  uint256 bountyPaid,
  uint256 protocolFeePaid
)
```

### `Claimed`
```typescript
event Claimed(
  uint256 indexed cycle,
  address indexed user,
  uint256 payout
)
```

---

## 💡 Frontend Development Tips

### 1. **Cycle Phase Detection**
```typescript
function getCyclePhase(round: Round) {
  const now = Date.now() / 1000; // Current time in seconds
  
  if (now < round.subscriptionEndTs) {
    return "BETTING"; // Users can place bets
  } else if (now < round.endTs) {
    return "PREDICTING"; // Waiting for volatility measurement
  } else if (now < round.endTs + finalityDelay) {
    return "FINALIZING"; // Safety period
  } else if (!round.resolved) {
    return "RESOLVABLE"; // Anyone can trigger settlement
  } else {
    return "RESOLVED"; // Can claim winnings
  }
}
```

### 2. **Calculate Expected Payout**
```typescript
function calculatePayout(userStake: bigint, round: Round, wonYes: boolean) {
  if (round.voided) return userStake; // Refund
  
  const totalPot = round.totalYes + round.totalNo;
  const distributable = totalPot - round.bountyPaid - round.protocolPaid;
  const winnerTotal = wonYes ? round.totalYes : round.totalNo;
  
  return (distributable * userStake) / winnerTotal;
}
```

### 3. **Display Pot Odds**
```typescript
function getOdds(round: Round) {
  const total = round.totalYes + round.totalNo;
  return {
    yesOdds: total / round.totalYes,  // e.g., 1.5x
    noOdds: total / round.totalNo,    // e.g., 2.3x
  };
}
```

### 4. **Countdown Timer**
```typescript
const timeUntilPhaseChange = round.subscriptionEndTs - Date.now() / 1000;
// Show countdown: "5:23 remaining to bet"
```

### 5. **USDC Approval (Required before betting)**
```typescript
// Check allowance
const { data: allowance } = useScaffoldReadContract({
  contractName: "USDC", // Or whatever your quoteToken is
  functionName: "allowance",
  args: [userAddress, contractAddress],
});

// Approve if needed
if (allowance < betAmount) {
  await approveUSDC(contractAddress, MAX_UINT256);
}
```

---

## 🎨 UI Components to Build

1. **Cycle Status Card** - Show current/next cycle, countdown, phase
2. **Betting Interface** - YES/NO buttons, amount input, odds display
3. **Pool Overview** - Total YES vs NO, pot size, current odds
4. **Your Position** - User's stakes, estimated payout, claim button
5. **History** - Past cycles, results, user P&L
6. **Leaderboard** - Top winners, most active bettors
7. **Resolve Button** - For keepers to trigger settlement (shows bounty)

---

## ⚠️ Error Handling

```typescript
// Common errors you'll encounter:
- "InvalidParams()" - Constructor validation failed
- "TooEarly()" - Trying to resolve before cycle ends
- "AlreadyResolved()" - Cycle already settled
- "CycleEnded()" - Subscription window closed
- "ZeroAmount()" - Can't bet/cancel 0
- "NothingToClaim()" - No winnings or already claimed
- "REENTRANCY" - Reentrancy guard triggered
- "SAFE/transferFrom" - USDC transfer failed (check approval)
- "insufficient" - Trying to cancel more than staked
```

---

## 🚀 Quick Start Example

```typescript
"use client";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { parseUnits, formatUnits } from "viem";

export default function BettingInterface() {
  // Get current cycle
  const { data: currentCycle } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "currentCycleIndex",
  });

  // Get round info
  const { data: round } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "getRound",
    args: [currentCycle],
  });

  // Write functions
  const { writeContractAsync } = useScaffoldWriteContract("HourlyVolatilityParimutuel");

  const betOnETH = async () => {
    await writeContractAsync({
      functionName: "stakeYes",
      args: [currentCycle, parseUnits("100", 6)], // 100 USDC
    });
  };

  return (
    <div>
      <h2>Cycle #{currentCycle?.toString()}</h2>
      <p>ETH Pool: {formatUnits(round?.totalYes || 0n, 6)} USDC</p>
      <p>MON Pool: {formatUnits(round?.totalNo || 0n, 6)} USDC</p>
      <button onClick={betOnETH}>Bet on ETH 🔥</button>
    </div>
  );
}
```

---

## 📋 Contract Deployment Info

**Contract Address:** `0x9CA6B4349e7EAf4aA9DAa8d27BBEf438906fde1a` (local testnet)

**Network:** Anvil Local (chainId: 31337)

**⚡ FAST DEMO MODE CONFIGURATION:**
- **Cycle Duration:** 180 seconds (60 sec bet + 120 sec predict)
- **Step Seconds:** 60 (60-second sampling intervals)
- **Finality Delay:** 5 seconds (resolve at 100 seconds)(someone gotta participate to resolve it and getting rewards for it)
- **Quote Token:** USDC (placeholder on testnet)
- **Keeper Bounty:** 10 bps (0.1%)
- **Protocol Fee:** 20 bps (0.2%)
- **Min Observation Cardinality:** 5

---

**Need help?** Check `/debug` page to interact with all contract functions directly! 🛠️

