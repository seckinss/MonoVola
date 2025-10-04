"use client";

import { useState } from "react";
import { NextPage } from "next";
import { formatUnits } from "viem";
import { useAccount, useBlock } from "wagmi";
import { BoltIcon, ChartBarIcon, CheckCircleIcon, ClockIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const HistoryPage: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const [isResolving, setIsResolving] = useState<{ [key: number]: boolean }>({});

  // Get blockchain time
  const { data: blockData } = useBlock({ watch: true });
  const blockchainTime = blockData?.timestamp ? Number(blockData.timestamp) : Math.floor(Date.now() / 1000);

  // Get finality delay
  const { data: finalityDelay } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "finalityDelaySeconds",
  });

  // Get recent rounds (last 20)
  const { data: historyData, refetch: refetchHistory } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "getRecentRounds",
    args: [20n],
  });

  const rounds = historyData?.[0] || [];
  const cycleIds = historyData?.[1] || [];

  // Write function for resolve
  const { writeContractAsync: writeContract } = useScaffoldWriteContract("HourlyVolatilityParimutuel");

  // Get user positions for all rounds if connected
  const { data: userPositions } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "getUserPositions",
    args: [connectedAddress || "0x0000000000000000000000000000000000000000", cycleIds],
    query: {
      enabled: !!connectedAddress && cycleIds.length > 0,
    },
  });

  const formatTime = (timestamp: bigint) => {
    return new Date(Number(timestamp) * 1000).toLocaleString();
  };

  const getRoundStatus = (round: any) => {
    if (round.resolved) return "RESOLVED";
    if (blockchainTime < Number(round.subscriptionEndTs)) return "BETTING";
    if (blockchainTime < Number(round.endTs)) return "PREDICTING";
    const finalityDelayTime = Number(round.endTs) + Number(finalityDelay || 10);
    if (blockchainTime < finalityDelayTime) return "FINALIZING";
    return "RESOLVABLE";
  };

  // Check if a round is truly resolvable (passed finality delay)
  const isRoundResolvable = (round: any) => {
    if (round.resolved) return false;
    const finalityDelayTime = Number(round.endTs) + Number(finalityDelay || 10);
    return blockchainTime >= finalityDelayTime;
  };

  // Calculate bounty for resolving
  const calculateBounty = (round: any) => {
    const totalPot = Number(formatUnits(round.totalYes + round.totalNo, 6));
    return totalPot * 0.001; // 0.1% bounty
  };

  // Handle resolve
  const handleResolve = async (cycleId: number) => {
    try {
      setIsResolving(prev => ({ ...prev, [cycleId]: true }));
      await writeContract({
        functionName: "resolve",
        args: [BigInt(cycleId)],
      });
      notification.success(`Round #${cycleId} resolved! Bounty earned!`);
      await refetchHistory();
    } catch (error: any) {
      console.error(error);
      notification.error(error?.message || "Resolution failed");
    } finally {
      setIsResolving(prev => ({ ...prev, [cycleId]: false }));
    }
  };

  // Get resolvable rounds
  const resolvableRounds = rounds
    .map((round: any, index: number) => ({ round, cycleId: Number(cycleIds[index]), index }))
    .filter(({ round }: any) => isRoundResolvable(round));

  const getUserResult = (round: any, cycleIndex: number) => {
    if (!userPositions || !connectedAddress) return null;

    const yesStake = userPositions[0][cycleIndex];
    const noStake = userPositions[1][cycleIndex];
    const claimed = userPositions[2][cycleIndex];

    if (yesStake === 0n && noStake === 0n) return null;

    const userSide = yesStake > 0n ? "ETH" : "MON";
    const userStake = Number(formatUnits(yesStake > 0n ? yesStake : noStake, 6));

    if (!round.resolved) {
      return { userSide, userStake, status: "PENDING", claimed: false };
    }

    if (round.voided) {
      return { userSide, userStake, status: "REFUNDED", claimed };
    }

    const won = (round.ethMoreVolatile && yesStake > 0n) || (!round.ethMoreVolatile && noStake > 0n);

    // Calculate payout
    let payout = 0;
    if (won) {
      const totalPot = round.totalYes + round.totalNo;
      const distributable = totalPot - round.bountyPaid - round.protocolPaid;
      const winnerTotal = round.ethMoreVolatile ? round.totalYes : round.totalNo;
      const userStakeBigInt = yesStake > 0n ? yesStake : noStake;
      if (winnerTotal > 0n) {
        const payoutBigInt = (BigInt(distributable) * BigInt(userStakeBigInt)) / BigInt(winnerTotal);
        payout = Number(formatUnits(payoutBigInt, 6));
      }
    }

    return {
      userSide,
      userStake,
      status: won ? "WON" : "LOST",
      claimed,
      payout,
    };
  };

  return (
    <div className="flex flex-col items-center pt-10 px-4 w-full">
      {/* Hero Section */}
      <div className="text-center mb-8">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          Round History
        </h1>
        <p className="text-xl text-base-content/70">View past rounds and their results</p>
      </div>

      {/* Resolvable Rounds Section */}
      {resolvableRounds.length > 0 && (
        <div className="card bg-gradient-to-br from-warning to-error shadow-2xl w-full max-w-7xl mb-6 border-4 border-warning">
          <div className="card-body">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <BoltIcon className="w-8 h-8 text-warning animate-pulse" />
                <div>
                  <h2 className="text-3xl font-bold">Resolvable Rounds</h2>
                  <p className="text-sm opacity-90">Earn bounties by resolving finished rounds</p>
                </div>
              </div>
              <div className="badge badge-warning badge-lg p-4 animate-pulse">
                {resolvableRounds.length} Round{resolvableRounds.length > 1 ? "s" : ""} Ready
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {resolvableRounds.map(({ round, cycleId }: any) => {
                const totalPot = Number(formatUnits(round.totalYes + round.totalNo, 6));
                const bounty = calculateBounty(round);

                return (
                  <div key={cycleId} className="card bg-base-100 shadow-xl hover:shadow-2xl transition-shadow">
                    <div className="card-body p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-bold text-lg">Cycle #{cycleId}</h3>
                        <div className="badge badge-error badge-sm">RESOLVABLE</div>
                      </div>

                      <div className="space-y-2 text-sm mb-3">
                        <div className="flex justify-between">
                          <span className="opacity-70">Total Pool:</span>
                          <span className="font-bold">${totalPot.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="opacity-70">Your Bounty:</span>
                          <span className="font-bold text-warning">${bounty.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="opacity-60">ETH Pool:</span>
                          <span className="text-primary">${Number(formatUnits(round.totalYes, 6)).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="opacity-60">MON Pool:</span>
                          <span className="text-secondary">${Number(formatUnits(round.totalNo, 6)).toFixed(2)}</span>
                        </div>
                      </div>

                      <button
                        className="btn btn-warning btn-sm w-full gap-2"
                        onClick={() => handleResolve(cycleId)}
                        disabled={isResolving[cycleId]}
                      >
                        {isResolving[cycleId] ? (
                          <>
                            <span className="loading loading-spinner loading-xs"></span>
                            Resolving...
                          </>
                        ) : (
                          <>
                            <BoltIcon className="w-4 h-4" />
                            Resolve & Claim ${bounty.toFixed(2)}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="alert alert-info mt-4">
              <div className="text-sm">
                <p className="font-bold mb-1">💰 How it works:</p>
                <p>
                  Click &quot;Resolve&quot; on any round to trigger the settlement. The contract will compare ETH vs MON
                  volatility and determine winners. You&apos;ll automatically receive a 0.1% bounty from the total pool!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Table */}
      <div className="card bg-base-100 shadow-xl w-full max-w-7xl">
        <div className="card-body">
          <h2 className="card-title text-2xl mb-4 flex items-center gap-2">
            <ChartBarIcon className="w-6 h-6" />
            Recent Rounds (Last 20)
          </h2>

          <div className="overflow-x-auto">
            <table className="table table-zebra w-full">
              <thead>
                <tr>
                  <th>Cycle</th>
                  <th>Status</th>
                  <th>Start Time</th>
                  <th>Winner</th>
                  <th>ETH Pool</th>
                  <th>MON Pool</th>
                  {connectedAddress && <th>Your Bet</th>}
                  {connectedAddress && <th>Result</th>}
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rounds.length === 0 ? (
                  <tr>
                    <td colSpan={connectedAddress ? 9 : 7} className="text-center py-8">
                      <div className="flex flex-col items-center gap-2">
                        <ClockIcon className="w-12 h-12 text-base-content/30" />
                        <p className="text-base-content/50">No rounds available yet</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rounds.map((round: any, index: number) => {
                    const cycleId = Number(cycleIds[index]);
                    const status = getRoundStatus(round);
                    const userResult = getUserResult(round, index);

                    return (
                      <tr key={cycleId}>
                        {/* Cycle */}
                        <td className="font-bold">#{cycleId}</td>

                        {/* Status */}
                        <td>
                          <div
                            className={`badge ${
                              status === "RESOLVED"
                                ? "badge-success"
                                : status === "BETTING"
                                  ? "badge-info"
                                  : status === "PREDICTING"
                                    ? "badge-warning"
                                    : status === "FINALIZING"
                                      ? "badge-warning"
                                      : "badge-error animate-pulse"
                            }`}
                          >
                            {status === "RESOLVABLE" ? "⚡ RESOLVABLE" : status}
                          </div>
                        </td>

                        {/* Start Time */}
                        <td className="text-sm">{formatTime(round.startTs)}</td>

                        {/* Winner */}
                        <td>
                          {round.resolved ? (
                            round.voided ? (
                              <span className="text-warning">Voided</span>
                            ) : (
                              <span
                                className={
                                  round.ethMoreVolatile ? "text-primary font-bold" : "text-secondary font-bold"
                                }
                              >
                                {round.ethMoreVolatile ? "ETH 🔥" : "MON 🔥"}
                              </span>
                            )
                          ) : (
                            <span className="text-base-content/50">-</span>
                          )}
                        </td>

                        {/* ETH Pool */}
                        <td className="text-primary font-semibold">
                          ${Number(formatUnits(round.totalYes, 6)).toFixed(2)}
                        </td>

                        {/* MON Pool */}
                        <td className="text-secondary font-semibold">
                          ${Number(formatUnits(round.totalNo, 6)).toFixed(2)}
                        </td>

                        {/* User Bet */}
                        {connectedAddress && (
                          <td>
                            {userResult ? (
                              <div className="text-sm">
                                <span
                                  className={`font-bold ${userResult.userSide === "ETH" ? "text-primary" : "text-secondary"}`}
                                >
                                  {userResult.userSide}
                                </span>{" "}
                                ${userResult.userStake.toFixed(2)}
                              </div>
                            ) : (
                              <span className="text-base-content/30">-</span>
                            )}
                          </td>
                        )}

                        {/* User Result */}
                        {connectedAddress && (
                          <td>
                            {userResult ? (
                              <div className="flex items-center gap-2">
                                {userResult.status === "WON" ? (
                                  <>
                                    <CheckCircleIcon className="w-5 h-5 text-success" />
                                    <div className="text-sm">
                                      <div className="text-success font-bold">Won</div>
                                      <div className="text-xs">${userResult.payout?.toFixed(2)}</div>
                                      {userResult.claimed && (
                                        <div className="badge badge-xs badge-success">Claimed</div>
                                      )}
                                    </div>
                                  </>
                                ) : userResult.status === "LOST" ? (
                                  <>
                                    <XCircleIcon className="w-5 h-5 text-error" />
                                    <span className="text-error text-sm">Lost</span>
                                  </>
                                ) : userResult.status === "REFUNDED" ? (
                                  <>
                                    <span className="text-warning text-sm">Refunded</span>
                                    {userResult.claimed && <div className="badge badge-xs badge-warning">Claimed</div>}
                                  </>
                                ) : (
                                  <span className="text-info text-sm">Pending</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-base-content/30">-</span>
                            )}
                          </td>
                        )}

                        {/* Action */}
                        <td>
                          {isRoundResolvable(round) ? (
                            <button
                              className="btn btn-warning btn-xs gap-1"
                              onClick={() => handleResolve(cycleId)}
                              disabled={isResolving[cycleId]}
                            >
                              {isResolving[cycleId] ? (
                                <>
                                  <span className="loading loading-spinner loading-xs"></span>
                                  <span className="hidden sm:inline">Resolving...</span>
                                </>
                              ) : (
                                <>
                                  <BoltIcon className="w-3 h-3" />
                                  <span className="hidden sm:inline">Resolve</span>
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="text-base-content/30 text-xs">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {!connectedAddress && (
            <div className="alert alert-info mt-4">
              <div>
                <p className="text-sm">Connect your wallet to see your betting history for each round.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stats Summary */}
      {connectedAddress && rounds.length > 0 && (
        <div className="card bg-base-100 shadow-xl w-full max-w-7xl mt-6">
          <div className="card-body">
            <h2 className="card-title text-xl">Quick Stats (Last 20 Rounds)</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
              <div className="stat bg-base-200 rounded-lg">
                <div className="stat-title text-xs">Your Participation</div>
                <div className="stat-value text-2xl text-info">
                  {userPositions
                    ? userPositions[0].filter((stake: bigint, i: number) => stake > 0n || userPositions[1][i] > 0n)
                        .length
                    : 0}
                </div>
                <div className="stat-desc">rounds played</div>
              </div>
              <div className="stat bg-base-200 rounded-lg">
                <div className="stat-title text-xs">Wins</div>
                <div className="stat-value text-2xl text-success">
                  {userPositions
                    ? rounds.filter((round: any, i: number) => {
                        const result = getUserResult(round, i);
                        return result && result.status === "WON";
                      }).length
                    : 0}
                </div>
                <div className="stat-desc">rounds won</div>
              </div>
              <div className="stat bg-base-200 rounded-lg">
                <div className="stat-title text-xs">Losses</div>
                <div className="stat-value text-2xl text-error">
                  {userPositions
                    ? rounds.filter((round: any, i: number) => {
                        const result = getUserResult(round, i);
                        return result && result.status === "LOST";
                      }).length
                    : 0}
                </div>
                <div className="stat-desc">rounds lost</div>
              </div>
              <div className="stat bg-base-200 rounded-lg">
                <div className="stat-title text-xs">Unclaimed</div>
                <div className="stat-value text-2xl text-warning">
                  {userPositions
                    ? rounds.filter((round: any, i: number) => {
                        const result = getUserResult(round, i);
                        return result && (result.status === "WON" || result.status === "REFUNDED") && !result.claimed;
                      }).length
                    : 0}
                </div>
                <div className="stat-desc">rounds to claim</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryPage;
