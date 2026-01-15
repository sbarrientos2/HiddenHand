/**
 * Test Script: Can we CPI to Inco from MagicBlock Ephemeral Rollup?
 *
 * This is THE critical test to determine if we can use:
 * - MagicBlock ER for fast gameplay (120ms)
 * - Inco FHE for cryptographic card encryption
 *
 * Test Flow:
 * 1. Initialize test state on devnet (if needed)
 * 2. Delegate the account to MagicBlock ER
 * 3. Connect to ER and call test_inco_cpi
 * 4. See if Inco CPI works from within the ER
 */

import { Connection, PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import pkg from "@coral-xyz/anchor";
const { AnchorProvider, Program, Wallet } = pkg;
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Program IDs
const INCO_ER_TEST_PROGRAM_ID = new PublicKey("J6gLdXApGmMLSbW33zihUa7RCfVtpAbhnqrZiFAAZLKg");
const INCO_LIGHTNING_PROGRAM_ID = new PublicKey("5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj");
const DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const BUFFER_PROGRAM_ID = new PublicKey("BUFFERjmBMVLaSbkLQBMSSH1M9LRP4T4oeHU1GrUBuuY");

// MagicBlock ER endpoint (devnet)
const ER_RPC_URL = "https://devnet.magicblock.app";
const DEVNET_RPC_URL = "https://api.devnet.solana.com";

// Seed
const TEST_STATE_SEED = Buffer.from("test_state_v3");

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║   CRITICAL TEST: Can ER CPI to Inco Lightning?                   ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  // Load wallet
  const walletPath = path.join(process.env.HOME, ".config/solana/id.json");
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  console.log("Wallet:", walletKeypair.publicKey.toString());

  // Connect to devnet
  const devnetConnection = new Connection(DEVNET_RPC_URL, "confirmed");
  const wallet = new Wallet(walletKeypair);
  const devnetProvider = new AnchorProvider(devnetConnection, wallet, { commitment: "confirmed" });

  // Load IDL
  const idlPath = path.join(__dirname, "../target/idl/inco_er_test.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, devnetProvider);

  // Derive PDA
  const [testStatePDA, bump] = PublicKey.findProgramAddressSync(
    [TEST_STATE_SEED, walletKeypair.publicKey.toBuffer()],
    INCO_ER_TEST_PROGRAM_ID
  );
  console.log("Test State PDA:", testStatePDA.toString());

  // Check if already initialized
  let existingAccount = await devnetConnection.getAccountInfo(testStatePDA);

  if (!existingAccount) {
    console.log("\n--- Step 1: Initialize Test State on Devnet ---");
    try {
      const tx = await program.methods
        .initialize()
        .accounts({
          authority: walletKeypair.publicKey,
          testState: testStatePDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Initialized! Tx:", tx);

      // Wait a moment for confirmation
      await new Promise(r => setTimeout(r, 2000));
      existingAccount = await devnetConnection.getAccountInfo(testStatePDA);
    } catch (e) {
      console.log("Failed to initialize:", e.message);
      return;
    }
  } else {
    console.log("Test state already initialized");
  }

  // Step 2: Delegate to MagicBlock ER
  console.log("\n--- Step 2: Delegate Account to MagicBlock ER ---");

  // Check if already delegated by looking at the account owner
  const accountInfo = await devnetConnection.getAccountInfo(testStatePDA);
  const currentOwner = accountInfo?.owner?.toString();
  console.log("Current owner:", currentOwner);

  // Derive the required PDAs for delegation
  const [delegateBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), testStatePDA.toBuffer()],
    INCO_ER_TEST_PROGRAM_ID
  );
  const [delegationRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), testStatePDA.toBuffer()],
    DELEGATION_PROGRAM_ID
  );
  const [delegationMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("delegation-metadata"), testStatePDA.toBuffer()],
    DELEGATION_PROGRAM_ID
  );

  console.log("Delegate Buffer PDA:", delegateBuffer.toString());
  console.log("Delegation Record PDA:", delegationRecord.toString());
  console.log("Delegation Metadata PDA:", delegationMetadata.toString());

  // The delegation program will change the owner
  // Let's try to delegate
  try {
    console.log("Attempting delegation...");
    const tx = await program.methods
      .delegateToEr()
      .accounts({
        payer: walletKeypair.publicKey,
        testState: testStatePDA,
        delegationProgram: DELEGATION_PROGRAM_ID,
        ownerProgram: INCO_ER_TEST_PROGRAM_ID,
        delegateBuffer: delegateBuffer,
        delegationRecord: delegationRecord,
        delegationMetadata: delegationMetadata,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Delegation tx:", tx);
    await new Promise(r => setTimeout(r, 3000));
  } catch (e) {
    console.log("Delegation attempt result:", e.message);
    if (e.logs) {
      console.log("Logs:");
      e.logs.slice(-10).forEach(log => console.log("  ", log));
    }
    // This might fail if already delegated or if our CPI is wrong
    // Let's continue anyway and see what happens with ER
  }

  // Step 3: Try to call test_inco_cpi from ER
  console.log("\n--- Step 3: Test Inco CPI from Ephemeral Rollup ---");
  console.log("Connecting to MagicBlock ER:", ER_RPC_URL);

  try {
    const erConnection = new Connection(ER_RPC_URL, "confirmed");
    const erProvider = new AnchorProvider(erConnection, wallet, { commitment: "confirmed" });
    const erProgram = new Program(idl, erProvider);

    // First try baseline test (no Inco) to verify ER is working
    console.log("\nTrying baseline test first (no Inco CPI)...");
    try {
      const baselineTx = await erProgram.methods
        .testBaseline()
        .accounts({
          authority: walletKeypair.publicKey,
          testState: testStatePDA,
        })
        .rpc();
      console.log("Baseline test succeeded on ER! Tx:", baselineTx);
    } catch (e) {
      console.log("Baseline test on ER failed:", e.message);
      if (e.logs) {
        console.log("Logs:", e.logs.slice(-5));
      }
    }

    // Now the real test - Inco CPI from ER
    console.log("\nNow testing Inco CPI from ER...");
    const tx = await erProgram.methods
      .testIncoCpi()
      .accounts({
        authority: walletKeypair.publicKey,
        testState: testStatePDA,
        incoProgram: INCO_LIGHTNING_PROGRAM_ID,
      })
      .rpc();

    console.log("\n╔══════════════════════════════════════════════════════════════════╗");
    console.log("║                    SUCCESS!!!                                    ║");
    console.log("║         Inco CPI works FROM the Ephemeral Rollup!                ║");
    console.log("║         This enables the hybrid architecture!                    ║");
    console.log("╚══════════════════════════════════════════════════════════════════╝");
    console.log("\nTransaction:", tx);

    // Fetch result from devnet (after commit)
    await new Promise(r => setTimeout(r, 5000));
    const testState = await program.account.testState.fetch(testStatePDA);
    console.log("\nTest State After ER CPI:");
    console.log("  - test_value:", testState.testValue.toString());
    console.log("  - inco_handle:", JSON.stringify(testState.incoHandle));
    console.log("  - test_completed:", testState.testCompleted);

  } catch (e) {
    console.log("\n╔══════════════════════════════════════════════════════════════════╗");
    console.log("║                    FAILED                                        ║");
    console.log("║         Inco CPI does NOT work from ER                           ║");
    console.log("╚══════════════════════════════════════════════════════════════════╝");
    console.log("\nError:", e.message);

    if (e.logs) {
      console.log("\nProgram Logs:");
      e.logs.forEach(log => console.log("  ", log));
    }

    console.log("\n--- Architecture Implications ---");
    console.log("If ER cannot CPI to Inco, we have alternatives:");
    console.log("1. Encrypt cards on base layer before delegating");
    console.log("2. Use client-side encryption (less secure)");
    console.log("3. Call Inco on commit (adds latency to showdown)");
  }

  console.log("\n═══════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
