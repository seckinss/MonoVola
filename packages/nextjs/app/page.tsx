"use client";

import Link from "next/link";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { BugAntIcon, ChartBarIcon, FireIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Address } from "~~/components/scaffold-eth";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();

  return (
    <>
      <div className="flex items-center flex-col grow pt-10">
        <div className="px-5">
          <h1 className="text-center">
            <span className="block text-2xl mb-2">Welcome to</span>
            <span className="block text-4xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent dark:text-white/90">
              MonoVolo
            </span>
          </h1>
          <p className="text-center text-xl mt-4 mb-6 text-base-content/70">
            Fast-Paced Volatility Prediction Market - Bet on ETH vs MON volatility
          </p>
          <div className="flex justify-center">
            <div className="badge badge-warning badge-lg">⚡ Testing Mode: 3-minute cycles</div>
          </div>
          <div className="flex justify-center items-center space-x-2 flex-col">
            <p className="my-2 font-medium">Connected Address:</p>
            <Address address={connectedAddress} />
          </div>

          <div className="flex justify-center mt-8">
            <Link href="/predict" className="btn btn-primary btn-lg gap-2">
              <FireIcon className="h-6 w-6" />
              Start Predicting
            </Link>
          </div>
        </div>

        <div className="grow bg-base-300 w-full mt-16 px-8 py-12">
          <div className="flex justify-center items-center gap-12 flex-col md:flex-row flex-wrap">
            <div className="flex flex-col bg-base-100 px-10 py-10 text-center items-center max-w-xs rounded-3xl">
              <ChartBarIcon className="h-8 w-8 fill-primary" />
              <p className="font-bold text-lg mb-2">Prediction Market</p>
              <p className="text-sm text-base-content/70">
                Place bets on{" "}
                <Link href="/predict" passHref className="link">
                  ETH vs MON volatility
                </Link>{" "}
                every hour
              </p>
            </div>
            <div className="flex flex-col bg-base-100 px-10 py-10 text-center items-center max-w-xs rounded-3xl">
              <BugAntIcon className="h-8 w-8 fill-secondary" />
              <p className="font-bold text-lg mb-2">Debug</p>
              <p className="text-sm text-base-content/70">
                Tinker with your smart contract using the{" "}
                <Link href="/debug" passHref className="link">
                  Debug Contracts
                </Link>{" "}
                tab
              </p>
            </div>
            <div className="flex flex-col bg-base-100 px-10 py-10 text-center items-center max-w-xs rounded-3xl">
              <MagnifyingGlassIcon className="h-8 w-8 fill-secondary" />
              <p className="font-bold text-lg mb-2">Explorer</p>
              <p className="text-sm text-base-content/70">
                Explore your local transactions with the{" "}
                <Link href="/blockexplorer" passHref className="link">
                  Block Explorer
                </Link>{" "}
                tab
              </p>
            </div>
          </div>

          <div className="max-w-3xl mx-auto mt-12 text-center">
            <h2 className="text-3xl font-bold mb-6">How It Works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-base-100 p-6 rounded-xl">
                <div className="text-3xl mb-3">💵</div>
                <h3 className="font-bold mb-2">Get Test USDC</h3>
                <p className="text-sm text-base-content/70">Mint free test USDC from the faucet on the Predict page</p>
                <div className="badge badge-sm badge-success mt-2">✅ Free tokens</div>
              </div>
              <div className="bg-base-100 p-6 rounded-xl">
                <div className="text-3xl mb-3">⏱️</div>
                <h3 className="font-bold mb-2">1 Min Betting</h3>
                <p className="text-sm text-base-content/70">Place your bets on which asset will be more volatile</p>
                <div className="badge badge-sm badge-warning mt-2">⚡ Fast testing</div>
              </div>
              <div className="bg-base-100 p-6 rounded-xl">
                <div className="text-3xl mb-3">💰</div>
                <h3 className="font-bold mb-2">Winners Split Pot</h3>
                <p className="text-sm text-base-content/70">Parimutuel system - winners share the entire prize pool</p>
                <div className="badge badge-sm badge-warning mt-2">⚡ Instant claim</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Home;
