"use client";

import { NextPage } from "next";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { CheckCircleIcon, GiftIcon, TrophyIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const ClaimsPage: NextPage = () => {
  const { address: connectedAddress } = useAccount();

  // Get claimable rounds (look back 100 rounds)
  const { data: claimableData, refetch: refetchClaimable } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "getClaimableRounds",
    args: [connectedAddress || "0x0000000000000000000000000000000000000000", 100n],
    query: {
      enabled: !!connectedAddress,
    },
  });

  const claimableCycles = claimableData?.[0] || [];
  const claimableAmounts = claimableData?.[1] || [];

  // Calculate total claimable
  const totalClaimable = claimableAmounts.reduce((sum: bigint, amount: bigint) => sum + amount, 0n);
  const totalClaimableUSD = Number(formatUnits(totalClaimable, 6));

  // Get rounds data for display
  const { data: roundsData } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "getRounds",
    args: [claimableCycles],
    query: {
      enabled: claimableCycles.length > 0,
    },
  });

  const rounds = roundsData || [];

  // Get user positions
  const { data: userPositions } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "getUserPositions",
    args: [connectedAddress || "0x0000000000000000000000000000000000000000", claimableCycles],
    query: {
      enabled: !!connectedAddress && claimableCycles.length > 0,
    },
  });

  // Write contract
  const { writeContractAsync: writeContract, isPending } = useScaffoldWriteContract("HourlyVolatilityParimutuel");

  // Handle individual claim
  const handleClaim = async (cycle: bigint) => {
    try {
      await writeContract({
        functionName: "claim",
        args: [cycle],
      });
      notification.success(`Claimed winnings from Cycle #${cycle}!`);
      refetchClaimable();
    } catch (error: any) {
      console.error(error);
      notification.error(error?.message || "Claim failed");
    }
  };

  // Handle batch claim
  const handleClaimAll = async () => {
    if (claimableCycles.length === 0) return;

    try {
      await writeContract({
        functionName: "claimBatch",
        args: [claimableCycles],
      });
      notification.success(
        `Claimed winnings from ${claimableCycles.length} rounds! Total: $${totalClaimableUSD.toFixed(2)}`,
      );
      refetchClaimable();
    } catch (error: any) {
      console.error(error);
      notification.error(error?.message || "Batch claim failed");
    }
  };

  const formatTime = (timestamp: bigint) => {
    return new Date(Number(timestamp) * 1000).toLocaleString();
  };

  return (
    <div className="flex flex-col items-center pt-10 px-4 w-full">
      {/* Hero Section */}
      <div className="text-center mb-8">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          Claim Winnings
        </h1>
        <p className="text-xl text-base-content/70">Claim your winnings from past rounds</p>
      </div>

      {connectedAddress ? (
        <>
          {/* Summary Card */}
          <div className="card bg-gradient-to-r from-primary to-secondary text-primary-content shadow-xl w-full max-w-6xl mb-6">
            <div className="card-body">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <GiftIcon className="w-16 h-16" />
                  <div>
                    <h2 className="text-4xl font-bold">${totalClaimableUSD.toFixed(2)}</h2>
                    <p className="text-lg opacity-90">
                      Unclaimed from {claimableCycles.length} round{claimableCycles.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                {claimableCycles.length > 0 && (
                  <button
                    className="btn btn-lg glass text-white hover:bg-white/20"
                    onClick={handleClaimAll}
                    disabled={isPending}
                  >
                    {isPending ? (
                      <span className="loading loading-spinner"></span>
                    ) : (
                      <>
                        <TrophyIcon className="w-6 h-6" />
                        Claim All {claimableCycles.length > 1 && `(${claimableCycles.length})`}
                      </>
                    )}
                  </button>
                )}
              </div>

              {claimableCycles.length > 1 && (
                <div className="alert bg-white/20 text-white mt-4">
                  <div>
                    <span className="font-bold">💡 Gas Saver Tip:</span>
                    <p className="text-sm">
                      Use &quot;Claim All&quot; to claim from multiple rounds in a single transaction and save on gas
                      fees!
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Claimable Rounds */}
          {claimableCycles.length > 0 ? (
            <div className="card bg-base-100 shadow-xl w-full max-w-6xl">
              <div className="card-body">
                <h2 className="card-title text-2xl mb-4 flex items-center gap-2">
                  <TrophyIcon className="w-6 h-6" />
                  Claimable Rounds
                </h2>

                <div className="grid grid-cols-1 gap-4">
                  {claimableCycles.map((cycle: bigint, index: number) => {
                    const round = rounds[index];
                    const amount = Number(formatUnits(claimableAmounts[index], 6));
                    const yesStake = userPositions?.[0][index] || 0n;
                    const noStake = userPositions?.[1][index] || 0n;
                    const yesStakeAmount = Number(formatUnits(yesStake, 6));
                    const noStakeAmount = Number(formatUnits(noStake, 6));
                    const totalStake = yesStakeAmount + noStakeAmount;
                    const hasBothBets = yesStake > 0n && noStake > 0n;

                    if (!round) return null;

                    return (
                      <div key={cycle.toString()} className="card bg-base-200">
                        <div className="card-body">
                          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className="text-xl font-bold">Cycle #{cycle.toString()}</h3>
                                {round.voided ? (
                                  <div className="badge badge-warning">Voided (Refund)</div>
                                ) : (
                                  <div className="badge badge-success">Won</div>
                                )}
                              </div>

                              <div className="text-sm text-base-content/70 space-y-1">
                                <p>Started: {formatTime(round.startTs)}</p>
                                <div>
                                  <p className="font-semibold">Your bet{hasBothBets ? "s" : ""}:</p>
                                  {yesStake > 0n && (
                                    <p className="ml-2">
                                      <span className="text-primary font-semibold">ETH</span> $
                                      {yesStakeAmount.toFixed(2)}
                                    </p>
                                  )}
                                  {noStake > 0n && (
                                    <p className="ml-2">
                                      <span className="text-secondary font-semibold">MON</span> $
                                      {noStakeAmount.toFixed(2)}
                                    </p>
                                  )}
                                  {hasBothBets && (
                                    <p className="ml-2 text-xs opacity-70">Total: ${totalStake.toFixed(2)}</p>
                                  )}
                                </div>
                                {!round.voided && (
                                  <p>
                                    Winner:{" "}
                                    <span className={round.ethMoreVolatile ? "text-primary" : "text-secondary"}>
                                      {round.ethMoreVolatile ? "ETH 🔥" : "MON 🔥"}
                                    </span>
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-2">
                              <div className="text-right">
                                <div className="text-sm text-base-content/70">Claimable Amount</div>
                                <div className="text-3xl font-bold text-success">${amount.toFixed(2)}</div>
                                {!round.voided && totalStake > 0 && (
                                  <div className="text-sm text-success">
                                    {((amount / totalStake - 1) * 100).toFixed(1)}% profit
                                  </div>
                                )}
                              </div>
                              <button
                                className="btn btn-success"
                                onClick={() => handleClaim(cycle)}
                                disabled={isPending}
                              >
                                {isPending ? (
                                  <span className="loading loading-spinner loading-sm"></span>
                                ) : (
                                  <>
                                    <CheckCircleIcon className="w-5 h-5" />
                                    Claim
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="card bg-base-100 shadow-xl w-full max-w-6xl">
              <div className="card-body">
                <div className="flex flex-col items-center gap-4 py-12">
                  <GiftIcon className="w-24 h-24 text-base-content/20" />
                  <div className="text-center">
                    <h3 className="text-2xl font-bold mb-2">No Unclaimed Winnings</h3>
                    <p className="text-base-content/70">
                      You don&apos;t have any winnings to claim at the moment.
                      <br />
                      Head to the{" "}
                      <a href="/predict" className="link link-primary">
                        Predict page
                      </a>{" "}
                      to place new bets!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Info Card */}
          <div className="card bg-base-100 shadow-xl w-full max-w-6xl mt-6">
            <div className="card-body">
              <h2 className="card-title text-xl">About Claims</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div className="alert alert-info">
                  <div>
                    <h3 className="font-bold">✅ When to Claim</h3>
                    <p className="text-sm">
                      Claim anytime after a round is resolved and you&apos;ve won (or if it was voided).
                    </p>
                  </div>
                </div>
                <div className="alert alert-success">
                  <div>
                    <h3 className="font-bold">💰 Batch Claiming</h3>
                    <p className="text-sm">
                      Claim from multiple rounds at once to save gas. One transaction = all your winnings!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="card bg-base-100 shadow-xl w-full max-w-6xl">
          <div className="card-body">
            <div className="alert alert-warning">
              <div>
                <h3 className="font-bold">Connect Your Wallet</h3>
                <p className="text-sm">Please connect your wallet to view and claim your winnings.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClaimsPage;
