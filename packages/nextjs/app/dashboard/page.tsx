"use client";

import { NextPage } from "next";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { ChartBarIcon, FireIcon, TrophyIcon, UserIcon } from "@heroicons/react/24/outline";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const DashboardPage: NextPage = () => {
  const { address: connectedAddress } = useAccount();

  // Get user stats
  const { data: userStats } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "getUserStats",
    args: [connectedAddress || "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: !!connectedAddress,
    },
  });

  // Get global stats
  const { data: globalStats } = useScaffoldReadContract({
    contractName: "HourlyVolatilityParimutuel",
    functionName: "getGlobalStats",
  });

  // Format user stats
  const wagered = userStats ? Number(formatUnits(userStats[0], 6)) : 0;
  const won = userStats ? Number(formatUnits(userStats[1], 6)) : 0;
  const profit = userStats
    ? Number(formatUnits(BigInt(Math.abs(Number(userStats[2]))), 6)) * (userStats[2] < 0 ? -1 : 1)
    : 0;
  const roundsPlayed = userStats ? Number(userStats[3]) : 0;
  const roundsWon = userStats ? Number(userStats[4]) : 0;
  const winRate = userStats ? Number(userStats[5]) / 100 : 0; // Convert from basis points to percentage

  // Format global stats
  const totalVolume = globalStats ? Number(formatUnits(globalStats[0], 6)) : 0;
  const totalRoundsResolved = globalStats ? Number(globalStats[1]) : 0;
  const currentRound = globalStats ? Number(globalStats[2]) : 0;

  return (
    <div className="flex flex-col items-center pt-10 px-4 w-full">
      {/* Hero Section */}
      <div className="text-center mb-8">
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          Dashboard
        </h1>
        <p className="text-xl text-base-content/70">Track your performance and platform statistics</p>
      </div>

      {/* Connected Address */}
      {connectedAddress && (
        <div className="card bg-base-200 shadow-xl w-full max-w-6xl mb-6">
          <div className="card-body">
            <div className="flex items-center gap-4">
              <UserIcon className="w-8 h-8 text-primary" />
              <div>
                <div className="text-sm text-base-content/70">Your Address</div>
                <Address address={connectedAddress} />
              </div>
            </div>
          </div>
        </div>
      )}

      {connectedAddress ? (
        <>
          {/* User Stats */}
          <div className="card bg-base-100 shadow-xl w-full max-w-6xl mb-6">
            <div className="card-body">
              <h2 className="card-title text-3xl mb-6 flex items-center gap-2">
                <TrophyIcon className="w-8 h-8 text-primary" />
                Your Statistics
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Total Wagered */}
                <div className="stat bg-base-200 rounded-lg text-base-content">
                  <div className="stat-figure text-primary">
                    <FireIcon className="w-8 h-8" />
                  </div>
                  <div className="stat-title text-base-content/80">Total Wagered</div>
                  <div className="stat-value text-primary dark:text-primary-content">${wagered.toFixed(2)}</div>
                  <div className="stat-desc">All-time betting volume</div>
                </div>

                {/* Total Won */}
                <div className="stat bg-base-200 rounded-lg">
                  <div className="stat-figure text-success">
                    <TrophyIcon className="w-8 h-8" />
                  </div>
                  <div className="stat-title">Total Won</div>
                  <div className="stat-value text-success">${won.toFixed(2)}</div>
                  <div className="stat-desc">Total winnings claimed</div>
                </div>

                {/* Net Profit */}
                <div className="stat bg-base-200 rounded-lg">
                  <div className={`stat-figure ${profit >= 0 ? "text-success" : "text-error"}`}>
                    <ChartBarIcon className="w-8 h-8" />
                  </div>
                  <div className="stat-title">Net Profit</div>
                  <div className={`stat-value ${profit >= 0 ? "text-success" : "text-error"}`}>
                    {profit >= 0 ? "+" : ""}${profit.toFixed(2)}
                  </div>
                  <div className="stat-desc">{profit >= 0 ? "You're winning!" : "Keep trying!"}</div>
                </div>
              </div>

              <div className="divider"></div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Rounds Played */}
                <div className="stat bg-base-200 rounded-lg">
                  <div className="stat-title">Rounds Played</div>
                  <div className="stat-value text-info">{roundsPlayed}</div>
                  <div className="stat-desc">Total participation</div>
                </div>

                {/* Rounds Won */}
                <div className="stat bg-base-200 rounded-lg">
                  <div className="stat-title">Rounds Won</div>
                  <div className="stat-value text-success">{roundsWon}</div>
                  <div className="stat-desc">Winning rounds</div>
                </div>

                {/* Win Rate */}
                <div className="stat bg-base-200 rounded-lg">
                  <div className="stat-title">Win Rate</div>
                  <div className="stat-value text-warning">{winRate.toFixed(1)}%</div>
                  <div className="stat-desc">
                    {winRate >= 60 ? "🔥 Amazing!" : winRate >= 50 ? "📈 Great!" : "Keep improving!"}
                  </div>
                </div>
              </div>

              {/* Performance Card */}
              {roundsPlayed > 0 && (
                <div className="mt-6">
                  <div className={`alert ${profit >= 0 ? "alert-success" : "alert-warning"}`}>
                    <div>
                      <h3 className="font-bold text-lg">Performance Summary</h3>
                      <p className="text-sm">
                        You&apos;ve played {roundsPlayed} rounds, won {roundsWon} times ({winRate.toFixed(1)}% win
                        rate), and your net profit is {profit >= 0 ? "+" : ""}${profit.toFixed(2)}.
                      </p>
                      {profit >= 0 ? (
                        <p className="text-sm mt-1">🎉 Keep up the great work!</p>
                      ) : (
                        <p className="text-sm mt-1">💪 Every expert was once a beginner!</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {roundsPlayed === 0 && (
                <div className="alert alert-info mt-6">
                  <div>
                    <h3 className="font-bold">Get Started!</h3>
                    <p className="text-sm">
                      You haven&apos;t placed any bets yet. Head to the{" "}
                      <a href="/predict" className="link">
                        Predict page
                      </a>{" "}
                      to start playing!
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="card bg-base-100 shadow-xl w-full max-w-6xl mb-6">
          <div className="card-body">
            <div className="alert alert-warning">
              <div>
                <h3 className="font-bold">Connect Your Wallet</h3>
                <p className="text-sm">Please connect your wallet to view your dashboard statistics.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global Stats */}
      <div className="card bg-base-100 shadow-xl w-full max-w-6xl">
        <div className="card-body">
          <h2 className="card-title text-3xl mb-6 flex items-center gap-2">
            <ChartBarIcon className="w-8 h-8 text-secondary" />
            Platform Statistics
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Volume */}
            <div className="stat bg-base-200 rounded-lg">
              <div className="stat-figure text-primary">
                <FireIcon className="w-8 h-8" />
              </div>
              <div className="stat-title">Total Volume</div>
              <div className="stat-value text-primary">${totalVolume.toFixed(2)}</div>
              <div className="stat-desc">All-time betting volume</div>
            </div>

            {/* Rounds Resolved */}
            <div className="stat bg-base-200 rounded-lg">
              <div className="stat-figure text-success">
                <TrophyIcon className="w-8 h-8" />
              </div>
              <div className="stat-title">Rounds Resolved</div>
              <div className="stat-value text-success">{totalRoundsResolved}</div>
              <div className="stat-desc">Completed rounds</div>
            </div>

            {/* Current Round */}
            <div className="stat bg-base-200 rounded-lg">
              <div className="stat-figure text-info">
                <ChartBarIcon className="w-8 h-8" />
              </div>
              <div className="stat-title">Current Round</div>
              <div className="stat-value text-info">#{currentRound}</div>
              <div className="stat-desc">Active cycle</div>
            </div>
          </div>

          <div className="alert alert-info mt-6">
            <div>
              <h3 className="font-bold">Platform Insights</h3>
              <p className="text-sm">
                {totalRoundsResolved > 0
                  ? `The platform has processed ${totalRoundsResolved} rounds with a total volume of $${totalVolume.toFixed(2)} USDC.`
                  : "Be the first to participate in this exciting prediction market!"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
