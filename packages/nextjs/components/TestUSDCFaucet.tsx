"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount } from "wagmi";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

/**
 * Test USDC Faucet Component
 * Allows users to mint test USDC and approve the market contract
 */
export const TestUSDCFaucet = () => {
  const { address } = useAccount();
  const [mintAmount, setMintAmount] = useState("1000");
  const [isApproving, setIsApproving] = useState(false);

  // Get USDC balance
  const { data: usdcBalance, refetch: refetchBalance } = useScaffoldReadContract({
    contractName: "MockUSDC",
    functionName: "balanceOf",
    args: [address || "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: !!address,
    },
  });

  // Get market contract address
  const { data: marketContractInfo } = useDeployedContractInfo("HourlyVolatilityParimutuel");
  const marketAddress = marketContractInfo?.address;

  // Get allowance
  const { data: allowance, refetch: refetchAllowance } = useScaffoldReadContract({
    contractName: "MockUSDC",
    functionName: "allowance",
    args: [address, marketAddress],
    query: {
      enabled: !!address && !!marketAddress,
    },
  });

  // Write functions
  const { writeContractAsync: writeMockUSDC } = useScaffoldWriteContract("MockUSDC");

  // Mint USDC
  const handleMint = async () => {
    if (!address || !mintAmount || parseFloat(mintAmount) <= 0) {
      notification.error("Please enter a valid amount");
      return;
    }

    try {
      const amount = parseUnits(mintAmount, 6);
      await writeMockUSDC({
        functionName: "mint",
        args: [address, amount],
      });
      notification.success(`Minted ${mintAmount} test USDC!`);
      refetchBalance();
    } catch (error: any) {
      console.error(error);
      notification.error(error?.message || "Mint failed");
    }
  };

  // Approve market contract
  const handleApprove = async () => {
    if (!address || !marketAddress) {
      notification.error("Market contract address not found");
      return;
    }

    setIsApproving(true);
    try {
      const maxApproval = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
      await writeMockUSDC({
        functionName: "approve",
        args: [marketAddress, maxApproval],
      });
      notification.success("Approved market contract to spend your USDC!");
      refetchAllowance();
    } catch (error: any) {
      console.error(error);
      notification.error(error?.message || "Approval failed");
    } finally {
      setIsApproving(false);
    }
  };

  if (!address) {
    return null;
  }

  const balance = usdcBalance ? Number(usdcBalance) / 1e6 : 0;
  const currentAllowance = allowance ? Number(allowance) / 1e6 : 0;
  const isApproved = currentAllowance > 1000000; // Considered approved if allowance > 1M USDC

  return (
    <div className="card bg-gradient-to-r from-success to-info text-white shadow-xl">
      <div className="card-body">
        <h3 className="card-title flex items-center gap-2">
          <BanknotesIcon className="w-6 h-6" />
          Test USDC Faucet
        </h3>
        <p className="text-sm opacity-90">Get free test USDC for local testing</p>

        <div className="stats bg-white/20 text-white mt-2 grid grid-cols-2">
          <div className="stat p-4">
            <div className="stat-title text-white/80">Your Balance</div>
            <div className="stat-value text-2xl">{balance.toFixed(2)} USDC</div>
          </div>
          <div className="stat p-4">
            <div className="stat-title text-white/80">Approval Status</div>
            <div className="stat-value text-xl">{isApproved ? "✅ Approved" : "❌ Not Approved"}</div>
          </div>
        </div>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text text-white">Amount to mint</span>
          </label>
          <div className="join">
            <input
              type="number"
              placeholder="1000"
              className="input input-bordered join-item text-black flex-1"
              value={mintAmount}
              onChange={e => setMintAmount(e.target.value)}
              min="0"
              step="100"
            />
            <button className="btn btn-primary join-item" onClick={handleMint}>
              Mint USDC
            </button>
          </div>
        </div>

        <div className="form-control mt-4">
          <button
            className={`btn btn-accent ${isApproving ? "loading" : ""}`}
            onClick={handleApprove}
            disabled={isApproving || isApproved}
          >
            {isApproving ? "Approving..." : isApproved ? "Already Approved" : "Approve Market Contract"}
          </button>
        </div>

        <div className="alert bg-white/20 mt-4">
          <div className="text-sm">
            <p className="font-bold">💡 Quick Start:</p>
            <ol className="list-decimal list-inside space-y-1 mt-2">
              <li>Mint test USDC using the button above</li>
              <li>Click &quot;Approve Market Contract&quot; to allow the prediction market to use your USDC</li>
              <li>You&apos;re ready to make predictions!</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};
