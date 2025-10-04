"use client";

import { useEffect, useState } from "react";
import { NextPage } from "next";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useBlock } from "wagmi";
import { ClockIcon, FireIcon, TrophyIcon } from "@heroicons/react/24/outline";
import { TestUSDCFaucet } from "~~/components/TestUSDCFaucet";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const PredictPage: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const [betAmount, setBetAmount] = useState("");
  const [localTime, setLocalTime] = useState(Math.floor(Date.now() / 1000));
  const [isApproving, setIsApproving] = useState(false);

  // Get blockchain time from latest block for accurate phase detection
  const { data: blockData } = useBlock({ watch: true });
  const blockchainTime = blockData?.timestamp ? Number(blockData.timestamp) : Math.floor(Date.now() / 1000);

  // Effective time for phase switching: use whichever is ahead to avoid stalling with no new blocks
  const currentTime = Math.max(blockchainTime, localTime);
  const displayTime = localTime;

  // Update local time every second for smooth countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setLocalTime(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Get current cycle
  const { data: currentCycle } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "currentCycleIndex",
  });

  // Get finality delay
  const { data: finalityDelay } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "finalityDelaySeconds",
  });

  // Get round info with polling to ensure fresh data
  const { data: round, refetch: refetchRound } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "getRound",
    args: [currentCycle || 0n],
    query: {
      enabled: currentCycle !== undefined,
      refetchInterval: 1000, // Poll every second for round data
    },
  });

  // Get user stakes
  const { data: userYesStake, refetch: refetchYes } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "userYes",
    args: [currentCycle || 0n, connectedAddress || "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: currentCycle !== undefined && !!connectedAddress,
    },
  });

  const { data: userNoStake, refetch: refetchNo } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "userNo",
    args: [currentCycle || 0n, connectedAddress || "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: currentCycle !== undefined && !!connectedAddress,
    },
  });

  const { data: userClaimed } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "userClaimed",
    args: [currentCycle || 0n, connectedAddress || "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: currentCycle !== undefined && !!connectedAddress,
    },
  });

  // Get deployed contract addresses
  const { data: marketAddress } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "quoteToken",
  });

  // Check user's USDC balance
  const { data: usdcBalance, refetch: refetchBalance } = useScaffoldReadContract({
    contractName: "MockUSDC",
    functionName: "balanceOf",
    args: [connectedAddress || "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: !!connectedAddress,
    },
  });

  // Check USDC allowance
  const { data: usdcAllowance, refetch: refetchAllowance } = useScaffoldReadContract({
    contractName: "MockUSDC",
    functionName: "allowance",
    args: [
      connectedAddress || "0x0000000000000000000000000000000000000000",
      marketAddress || "0x0000000000000000000000000000000000000000",
    ],
    query: {
      enabled: !!connectedAddress && !!marketAddress,
    },
  });

  // Write functions
  const { writeContractAsync: writeContract } = useScaffoldWriteContract("HourlyVolatilityParimutuel");
  const { writeContractAsync: writeUSDC } = useScaffoldWriteContract("MockUSDC");

  // Calculate phase
  const getPhase = () => {
    if (!round) return "LOADING";

    if (round.resolved) return "RESOLVED";

    // Use the ahead-of-time clock for pre-finality cutovers to avoid UI stalling
    const preSwitchTime = Math.max(blockchainTime, displayTime);
    if (preSwitchTime < Number(round.subscriptionEndTs)) return "BETTING";
    if (preSwitchTime < Number(round.endTs)) return "PREDICTING";

    // For finality/resolution gating, rely strictly on blockchain time
    const finalityDelayTime = Number(round.endTs) + Number(finalityDelay || 10);
    if (blockchainTime < finalityDelayTime) return "FINALIZING";

    return "RESOLVABLE";
  };

  const phase = getPhase();

  // Force refetch round data when blockchain time changes
  const [lastBlockTime, setLastBlockTime] = useState(0);
  useEffect(() => {
    if (blockchainTime > 0 && blockchainTime !== lastBlockTime) {
      setLastBlockTime(blockchainTime);
      // Refetch round data to get latest state
      refetchRound();
    }
  }, [blockchainTime, lastBlockTime, refetchRound]);

  // Auto-refresh when phase transitions occur
  const [lastPhase, setLastPhase] = useState<string>("LOADING");
  useEffect(() => {
    if (phase !== lastPhase && lastPhase !== "LOADING") {
      // Refetch round data on phase change for fresh state
      if (phase === "PREDICTING" || phase === "RESOLVABLE" || phase === "RESOLVED") {
        refetchRound();
        if (connectedAddress) {
          refetchYes();
          refetchNo();
        }
      }
    }
    setLastPhase(phase);
  }, [phase, lastPhase, connectedAddress, refetchRound, refetchYes, refetchNo]);

  // Calculate time remaining (use displayTime for smooth countdown, but ensure consistency with phase)
  const getTimeRemaining = () => {
    if (!round) return 0;
    let remaining = 0;

    if (phase === "BETTING") {
      remaining = Number(round.subscriptionEndTs) - displayTime;
    } else if (phase === "PREDICTING") {
      remaining = Number(round.endTs) - displayTime;
    } else if (phase === "FINALIZING") {
      const finalityDelayTime = Number(round.endTs) + Number(finalityDelay || 10);
      remaining = finalityDelayTime - displayTime;
    } else if (phase === "RESOLVABLE") {
      // When resolvable, no countdown needed
      return 0;
    }

    // Use blockchain time as a safety check - if blockchain says we're past the deadline,
    // force remaining to 0 even if local time hasn't caught up
    if (phase === "BETTING") {
      if (currentTime >= Number(round.subscriptionEndTs)) return 0;
    } else if (phase === "PREDICTING") {
      if (currentTime >= Number(round.endTs)) return 0;
    } else if (phase === "FINALIZING") {
      const finalityDelayTime = Number(round.endTs) + Number(finalityDelay || 10);
      if (currentTime >= finalityDelayTime) return 0;
    }

    // Return 0 if negative
    return Math.max(0, remaining);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Calculate odds
  const getOdds = () => {
    if (!round || round.totalYes === 0n || round.totalNo === 0n) {
      return { yesOdds: 0, noOdds: 0 };
    }
    const total = Number(formatUnits(round.totalYes + round.totalNo, 6));
    const yesTotal = Number(formatUnits(round.totalYes, 6));
    const noTotal = Number(formatUnits(round.totalNo, 6));
    return {
      yesOdds: yesTotal > 0 ? total / yesTotal : 0,
      noOdds: noTotal > 0 ? total / noTotal : 0,
    };
  };

  const odds = getOdds();

  // Calculate potential payout
  const calculatePayout = (userStake: bigint, isYes: boolean) => {
    if (!round || !userStake || userStake === 0n) return 0;
    if (round.voided) return Number(formatUnits(userStake, 6));

    const totalPot = round.totalYes + round.totalNo;
    const distributable = totalPot - round.bountyPaid - round.protocolPaid;
    const winnerTotal = isYes ? round.totalYes : round.totalNo;

    if (winnerTotal === 0n) return 0;

    const payout = (distributable * userStake) / winnerTotal;
    return Number(formatUnits(payout, 6));
  };

  // Handle approval
  const handleApprove = async () => {
    if (!marketAddress) {
      notification.error("Contract address not found");
      return;
    }

    try {
      setIsApproving(true);
      await writeUSDC({
        functionName: "approve",
        args: [marketAddress, parseUnits("1000000", 6)], // Approve 1M USDC
      });
      notification.success("USDC approved! You can now place bets.");
      await refetchAllowance();
    } catch (error: any) {
      console.error(error);
      notification.error(error?.message || "Approval failed");
    } finally {
      setIsApproving(false);
    }
  };

  // Handle betting
  const handleBet = async (isYes: boolean) => {
    if (!betAmount || parseFloat(betAmount) <= 0) {
      notification.error("Please enter a valid amount");
      return;
    }

    const amount = parseUnits(betAmount, 6);

    // Check if user has enough USDC balance
    if (!usdcBalance || usdcBalance < amount) {
      notification.error(
        `Insufficient USDC balance. You have ${usdcBalance ? Number(formatUnits(usdcBalance, 6)).toFixed(2) : "0"} USDC. Please mint tokens first.`,
      );
      return;
    }

    // Check if approval is needed
    if (!usdcAllowance || usdcAllowance < amount) {
      notification.error("Please approve USDC spending first");
      return;
    }

    try {
      await writeContract({
        functionName: isYes ? "stakeYes" : "stakeNo",
        args: [currentCycle, amount],
      });
      notification.success(`Bet placed: ${betAmount} USDC on ${isYes ? "ETH" : "MON"}`);
      setBetAmount("");
      refetchRound();
      refetchYes();
      refetchNo();
      refetchAllowance();
      refetchBalance();
    } catch (error: any) {
      console.error(error);
      notification.error(error?.message || "Transaction failed");
    }
  };

  // Handle claim
  const handleClaim = async () => {
    try {
      await writeContract({
        functionName: "claim",
        args: [currentCycle],
      });
      notification.success("Winnings claimed!");
      refetchRound();
      refetchYes();
      refetchNo();
    } catch (error: any) {
      console.error(error);
      notification.error(error?.message || "Claim failed");
    }
  };

  // Handle resolve
  const handleResolve = async () => {
    try {
      await writeContract({
        functionName: "resolve",
        args: [currentCycle],
      });
      notification.success("Round resolved! You earned the bounty!");
      refetchRound();
    } catch (error: any) {
      console.error(error);
      notification.error(error?.message || "Resolution failed");
    }
  };

  const totalPot = round ? Number(formatUnits(round.totalYes + round.totalNo, 6)) : 0;
  const userYesAmount = userYesStake ? Number(formatUnits(userYesStake, 6)) : 0;
  const userNoAmount = userNoStake ? Number(formatUnits(userNoStake, 6)) : 0;
  const userTotalStake = userYesAmount + userNoAmount;

  return (
    <div className="flex flex-col items-center pt-10 px-4 w-full">
      {/* Hero Section */}
      <div className="text-center mb-8">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          Volatility Prediction Market
        </h1>
        <p className="text-xl text-base-content/70">Will ETH or MON be more volatile? Place your bets!</p>
        <div className="badge badge-warning mt-2">⚡ Fast Demo Mode: 90-second cycles</div>
      </div>

      {/* Cycle Info Card */}
      <div className="card bg-base-200 shadow-xl w-full max-w-6xl mb-6">
        <div className="card-body">
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <h2 className="text-3xl font-bold">Cycle #{currentCycle?.toString() || "..."}</h2>
              <div className="flex items-center gap-2 mt-2">
                <div
                  className={`badge badge-lg ${
                    phase === "BETTING"
                      ? "badge-success"
                      : phase === "PREDICTING"
                        ? "badge-warning"
                        : phase === "FINALIZING"
                          ? "badge-warning"
                          : phase === "RESOLVABLE"
                            ? "badge-error animate-pulse"
                            : "badge-info"
                  }`}
                >
                  {phase === "RESOLVABLE" ? "⚡ RESOLVABLE" : phase}
                </div>
                {(phase === "BETTING" || phase === "PREDICTING" || phase === "FINALIZING") && (
                  <div className="flex items-center gap-1 text-lg">
                    <ClockIcon className="w-5 h-5" />
                    <span className="font-mono font-bold">{formatTime(getTimeRemaining())}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="stats shadow">
              <div className="stat place-items-center">
                <div className="stat-title">Total Pool</div>
                <div className="stat-value text-primary">${totalPot.toFixed(2)}</div>
                <div className="stat-desc">USDC</div>
              </div>
            </div>
          </div>

          {/* Phase Timeline */}
          {round && (phase === "BETTING" || phase === "PREDICTING") && (
            <div className="mt-6">
              <div className="grid grid-cols-2 gap-4">
                {/* Betting Window */}
                <div
                  className={`relative p-4 rounded-lg border-2 transition-all ${
                    phase === "BETTING"
                      ? "border-success bg-success/10 shadow-lg"
                      : "border-base-300 bg-base-100 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <span className={`text-2xl ${phase === "BETTING" ? "animate-pulse" : ""}`}>🎯</span>
                      Betting Window
                    </h3>
                    {phase === "BETTING" && <div className="badge badge-success badge-sm">ACTIVE</div>}
                    {phase === "PREDICTING" && <div className="badge badge-ghost badge-sm">CLOSED</div>}
                  </div>
                  <div className="text-sm text-base-content/70">Duration: 30 seconds</div>
                  {phase === "BETTING" && (
                    <div className="mt-2">
                      <div className="text-lg font-mono font-bold text-success">
                        {formatTime(getTimeRemaining())} remaining
                      </div>
                      <progress
                        className="progress progress-success w-full mt-1"
                        value={round ? 30 - (Number(round.subscriptionEndTs) - displayTime) : 0}
                        max={30}
                      ></progress>
                    </div>
                  )}
                </div>

                {/* Prediction Window */}
                <div
                  className={`relative p-4 rounded-lg border-2 transition-all ${
                    phase === "PREDICTING"
                      ? "border-warning bg-warning/10 shadow-lg"
                      : "border-base-300 bg-base-100 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <span className={`text-2xl ${phase === "PREDICTING" ? "animate-pulse" : ""}`}>📊</span>
                      Prediction Window
                    </h3>
                    {phase === "PREDICTING" && <div className="badge badge-warning badge-sm">ACTIVE</div>}
                    {phase === "BETTING" && <div className="badge badge-ghost badge-sm">PENDING</div>}
                  </div>
                  <div className="text-sm text-base-content/70">Duration: 60 seconds</div>
                  {phase === "PREDICTING" && (
                    <div className="mt-2">
                      <div className="text-lg font-mono font-bold text-warning">
                        {formatTime(getTimeRemaining())} remaining
                      </div>
                      <progress
                        className="progress progress-warning w-full mt-1"
                        value={round ? 60 - (Number(round.endTs) - displayTime) : 0}
                        max={60}
                      ></progress>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-6xl">
        {/* Betting Interface */}
        {phase === "BETTING" && (
          <div className="card bg-base-100 shadow-xl lg:col-span-2">
            <div className="card-body">
              <h2 className="card-title text-2xl mb-4">Place Your Bet</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* ETH Side */}
                <div className="border-2 border-primary rounded-lg p-6 hover:bg-primary/5 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-2xl font-bold flex items-center gap-2">
                      <FireIcon className="w-8 h-8 text-primary" />
                      ETH More Volatile
                    </h3>
                  </div>
                  <div className="stats bg-base-200 mb-4 w-full">
                    <div className="stat">
                      <div className="stat-title">Pool</div>
                      <div className="stat-value text-primary">
                        ${round ? Number(formatUnits(round.totalYes, 6)).toFixed(2) : "0.00"}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="stat-title">Odds</div>
                      <div className="stat-value text-primary">{odds.yesOdds.toFixed(2)}x</div>
                    </div>
                  </div>
                  <button
                    className="btn btn-primary w-full btn-lg"
                    onClick={() => handleBet(true)}
                    disabled={!connectedAddress || !betAmount}
                  >
                    Bet on ETH
                  </button>
                </div>

                {/* MON Side */}
                <div className="border-2 border-secondary rounded-lg p-6 hover:bg-secondary/5 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-2xl font-bold flex items-center gap-2">
                      <FireIcon className="w-8 h-8 text-secondary" />
                      MON More Volatile
                    </h3>
                  </div>
                  <div className="stats bg-base-200 mb-4 w-full">
                    <div className="stat">
                      <div className="stat-title">Pool</div>
                      <div className="stat-value text-secondary">
                        ${round ? Number(formatUnits(round.totalNo, 6)).toFixed(2) : "0.00"}
                      </div>
                    </div>
                    <div className="stat">
                      <div className="stat-title">Odds</div>
                      <div className="stat-value text-secondary">{odds.noOdds.toFixed(2)}x</div>
                    </div>
                  </div>
                  <button
                    className="btn btn-secondary w-full btn-lg"
                    onClick={() => handleBet(false)}
                    disabled={!connectedAddress || !betAmount}
                  >
                    Bet on MON
                  </button>
                </div>
              </div>

              {/* Amount Input */}
              <div className="form-control mt-4">
                <label className="label">
                  <span className="label-text text-lg">Bet Amount (USDC)</span>
                  {connectedAddress && usdcBalance !== undefined && (
                    <span className="label-text-alt text-base">
                      Balance: {Number(formatUnits(usdcBalance, 6)).toFixed(2)} USDC
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  placeholder="100.00"
                  className="input input-bordered input-lg w-full"
                  value={betAmount}
                  onChange={e => setBetAmount(e.target.value)}
                  min="0"
                  step="0.01"
                />
              </div>

              {/* Balance Warning */}
              {connectedAddress && usdcBalance !== undefined && usdcBalance === 0n && (
                <div className="alert alert-error mt-4">
                  <div className="flex flex-col gap-2 w-full">
                    <div>
                      <span className="font-bold">❌ No USDC Balance</span>
                      <p className="text-sm">You need to mint USDC tokens first. Use the faucet below.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Approval Section */}
              {connectedAddress &&
                usdcBalance !== undefined &&
                usdcBalance > 0n &&
                (!usdcAllowance || usdcAllowance === 0n) && (
                  <div className="alert alert-warning mt-4">
                    <div className="flex flex-col gap-2 w-full">
                      <div>
                        <span className="font-bold">⚠️ Approval Required</span>
                        <p className="text-sm">You need to approve USDC spending before placing bets.</p>
                      </div>
                      <button className="btn btn-warning w-full" onClick={handleApprove} disabled={isApproving}>
                        {isApproving ? "Approving..." : "Approve USDC"}
                      </button>
                    </div>
                  </div>
                )}

              {connectedAddress && usdcAllowance && usdcAllowance > 0n && (
                <div className="alert alert-success mt-4">
                  <span className="text-sm">
                    ✓ USDC Approved: {Number(formatUnits(usdcAllowance, 6)).toFixed(2)} USDC
                  </span>
                </div>
              )}

              {/* Show warning when blockchain time is lagging in betting phase */}
              {getTimeRemaining() === 0 && round && blockchainTime < Number(round.subscriptionEndTs) && (
                <div className="alert alert-warning mt-4">
                  <div className="text-sm">
                    <p className="font-bold">⏳ Waiting for blockchain to catch up...</p>
                    <p className="mt-1">
                      Blockchain time is slightly behind. Make a transaction (like placing a bet) to produce a new block
                      and advance time.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Your Position */}
        {userTotalStake > 0 && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title text-2xl">Your Position</h2>
              <div className="space-y-4">
                {userYesAmount > 0 && (
                  <div className="alert alert-info">
                    <div>
                      <div className="font-bold">ETH Bet: ${userYesAmount.toFixed(2)}</div>
                      {phase === "RESOLVED" && round?.ethMoreVolatile && !round?.voided && (
                        <div className="text-sm">
                          Potential Payout: ${calculatePayout(userYesStake!, true).toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {userNoAmount > 0 && (
                  <div className="alert alert-info">
                    <div>
                      <div className="font-bold">MON Bet: ${userNoAmount.toFixed(2)}</div>
                      {phase === "RESOLVED" && !round?.ethMoreVolatile && !round?.voided && (
                        <div className="text-sm">
                          Potential Payout: ${calculatePayout(userNoStake!, false).toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {phase === "RESOLVED" && !userClaimed && (
                  <button className="btn btn-success w-full btn-lg" onClick={handleClaim}>
                    <TrophyIcon className="w-6 h-6" />
                    Claim Winnings
                  </button>
                )}

                {userClaimed && <div className="alert alert-success">✓ Winnings Claimed!</div>}
              </div>
            </div>
          </div>
        )}

        {/* Resolution - Full Width Prominent Card */}
        {phase === "RESOLVABLE" && round && (
          <div className="card bg-gradient-to-br from-warning to-error shadow-2xl lg:col-span-2 border-4 border-warning">
            <div className="card-body">
              <div className="flex items-center gap-3 mb-4">
                <div className="badge badge-warning badge-lg p-4 animate-pulse">READY TO RESOLVE</div>
                <h2 className="card-title text-3xl font-bold">🎯 Resolve This Round</h2>
              </div>

              <div className="bg-base-100 rounded-lg p-6 mb-4">
                <p className="text-lg mb-4">
                  The prediction phase has ended! Anyone can resolve this round and earn a{" "}
                  <strong>0.1% keeper bounty</strong> from the total pool.
                </p>

                <div className="stats stats-vertical lg:stats-horizontal shadow w-full mb-4">
                  <div className="stat">
                    <div className="stat-title">Total Pool</div>
                    <div className="stat-value text-success">${totalPot.toFixed(2)}</div>
                    <div className="stat-desc">USDC wagered</div>
                  </div>
                  <div className="stat">
                    <div className="stat-title">Your Bounty</div>
                    <div className="stat-value text-warning">${(totalPot * 0.001).toFixed(2)}</div>
                    <div className="stat-desc">0.1% of pool</div>
                  </div>
                </div>

                <div className="alert alert-info mb-4">
                  <div className="text-sm">
                    <p className="font-bold mb-1">📊 How Resolution Works:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Contract reads Uniswap V3 price data from the prediction window</li>
                      <li>Calculates volatility for both ETH and MON</li>
                      <li>Determines winner and distributes rewards</li>
                      <li>You receive 0.1% bounty for calling resolve()</li>
                    </ul>
                  </div>
                </div>

                <div className="alert alert-success">
                  <div className="text-xs">
                    <p className="font-bold mb-1">✅ Timing Check:</p>
                    <p>
                      Blockchain Time: {new Date(blockchainTime * 1000).toLocaleTimeString()} | Resolution Required
                      After: {new Date((Number(round.endTs) + Number(finalityDelay || 10)) * 1000).toLocaleTimeString()}
                    </p>
                    <p className="mt-2">
                      Status:{" "}
                      <span className="font-bold">
                        {blockchainTime >= Number(round.endTs) + Number(finalityDelay || 10)
                          ? "✅ READY TO RESOLVE NOW"
                          : "⚠️ Waiting for finality delay - refresh in a moment"}
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              <button
                className="btn btn-warning w-full btn-lg text-xl font-bold shadow-lg hover:scale-105 transition-transform"
                onClick={handleResolve}
              >
                🎯 Resolve Round & Claim ${(totalPot * 0.001).toFixed(2)} Bounty
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        {phase === "RESOLVED" && round && (
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h2 className="card-title text-2xl">Round Results</h2>
              {round.voided ? (
                <div className="alert alert-warning">
                  <span>Round was voided - all bets refunded</span>
                </div>
              ) : (
                <div>
                  <div className="alert alert-success mb-4">
                    <span className="text-xl font-bold">
                      {round.ethMoreVolatile ? "🔥 ETH" : "🔥 MON"} was more volatile!
                    </span>
                  </div>
                  <div className="stats stats-vertical shadow w-full">
                    <div className="stat">
                      <div className="stat-title">ETH Volatility Score</div>
                      <div className="stat-value text-primary">{round.ethMetric.toString()}</div>
                    </div>
                    <div className="stat">
                      <div className="stat-title">MON Volatility Score</div>
                      <div className="stat-value text-secondary">{round.monMetric.toString()}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Predicting Phase Info */}
        {phase === "PREDICTING" && (
          <div className="card bg-base-100 shadow-xl lg:col-span-2">
            <div className="card-body">
              <h2 className="card-title text-2xl">Prediction Phase</h2>
              <p className="text-lg">Betting is closed. Measuring volatility using Uniswap V3 TWAP data...</p>
              <progress className="progress progress-primary w-full"></progress>

              {/* Show warning when blockchain time is lagging */}
              {getTimeRemaining() === 0 && round && blockchainTime < Number(round.endTs) && (
                <div className="alert alert-warning mt-4">
                  <div className="text-sm">
                    <p className="font-bold">⏳ Waiting for blockchain to catch up...</p>
                    <p className="mt-1">
                      Blockchain time is slightly behind. Make any transaction to produce a new block and advance time.
                    </p>
                    <p className="text-xs mt-2 opacity-70">
                      Current blockchain: {new Date(blockchainTime * 1000).toLocaleTimeString()} | Phase ends:{" "}
                      {new Date(Number(round.endTs) * 1000).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Finalizing Phase Info */}
        {phase === "FINALIZING" && (
          <div className="card bg-base-100 shadow-xl lg:col-span-2 border-2 border-warning">
            <div className="card-body">
              <div className="flex items-center gap-3 mb-4">
                <div className="loading loading-spinner loading-lg text-warning"></div>
                <h2 className="card-title text-3xl">⏳ Finalizing Round</h2>
              </div>

              <div className="text-center mb-4 bg-base-200 rounded-lg p-4">
                <p className="text-xl font-bold mb-2">Resolution Available In</p>
                <p className="text-4xl font-mono font-bold text-warning">{formatTime(getTimeRemaining())}</p>
              </div>

              <div className="alert alert-info mb-4">
                <div>
                  <span className="font-bold text-lg">🛡️ Safety Period in Progress</span>
                  <p className="text-sm mt-2">
                    The contract enforces a <strong>{finalityDelay || 10}-second finality delay</strong> to ensure:
                  </p>
                  <ul className="list-disc list-inside text-sm mt-2 space-y-1 ml-4">
                    <li>Uniswap V3 price data is stable and complete</li>
                    <li>No reorgs can affect the outcome</li>
                    <li>Fair and accurate volatility measurements</li>
                  </ul>
                  <div className="mt-3 pt-2 border-t border-base-300">
                    <p className="text-xs opacity-70">
                      📅 Blockchain: {new Date(blockchainTime * 1000).toLocaleTimeString()} | 🎯 Resolution:{" "}
                      {round &&
                        new Date((Number(round.endTs) + Number(finalityDelay || 10)) * 1000).toLocaleTimeString()}
                    </p>
                    <p className="text-xs mt-1 opacity-60">
                      ⚠️ Local blockchain time updates with transactions. Countdown uses local time.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-warning/10 rounded-lg p-4 text-center">
                <p className="text-sm font-semibold">
                  💰 When the timer hits zero, you can resolve and earn a <strong>0.1% bounty</strong>!
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Test USDC Faucet */}
      {connectedAddress && (
        <div className="w-full max-w-6xl mt-6">
          <TestUSDCFaucet />
        </div>
      )}

      {/* Info Section */}
      <div className="card bg-base-100 shadow-xl w-full max-w-6xl mt-6">
        <div className="card-body">
          <h2 className="card-title text-2xl">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="flex flex-col items-center text-center p-4">
              <div className="text-4xl mb-2">1️⃣</div>
              <h3 className="font-bold text-lg mb-2">Bet (30 sec)</h3>
              <p className="text-sm text-base-content/70">Place your bet on whether ETH or MON will be more volatile</p>
              <div className="badge badge-sm badge-success mt-1">Betting Window</div>
            </div>
            <div className="flex flex-col items-center text-center p-4">
              <div className="text-4xl mb-2">2️⃣</div>
              <h3 className="font-bold text-lg mb-2">Predict (60 sec)</h3>
              <p className="text-sm text-base-content/70">
                Contract measures real volatility using Uniswap V3 price data
              </p>
              <div className="badge badge-sm badge-warning mt-1">Measuring Phase</div>
            </div>
            <div className="flex flex-col items-center text-center p-4">
              <div className="text-4xl mb-2">3️⃣</div>
              <h3 className="font-bold text-lg mb-2">Claim (after 90 sec)</h3>
              <p className="text-sm text-base-content/70">Winners split the entire pot (parimutuel style)</p>
              <div className="badge badge-sm badge-info mt-1">+ 10 sec finality</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PredictPage;
