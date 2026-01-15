/**
 * Test Script: Can we CPI to Inco Lightning from our program?
 *
 * This script tests if Inco's e_rand() function can be called via CPI.
 *
 * Test Plan:
 * 1. Initialize test state account
 * 2. Call test_inco_cpi instruction (attempts CPI to Inco e_rand)
 * 3. Check if it succeeded or failed
 */

import { Connection, PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
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

// Seed
const TEST_STATE_SEED = Buffer.from("test_state");

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║           INCO CPI TEST - Can we call e_rand()?                  ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  // Load wallet
  const walletPath = path.join(process.env.HOME, ".config/solana/id.json");
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  console.log("Wallet:", walletKeypair.publicKey.toString());

  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

  // Load IDL
  const idlPath = path.join(__dirname, "../target/idl/inco_er_test.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  // Derive PDA
  const [testStatePDA, bump] = PublicKey.findProgramAddressSync(
    [TEST_STATE_SEED, walletKeypair.publicKey.toBuffer()],
    INCO_ER_TEST_PROGRAM_ID
  );
  console.log("Test State PDA:", testStatePDA.toString());

  // Check if already initialized
  const existingAccount = await connection.getAccountInfo(testStatePDA);

  if (!existingAccount) {
    console.log("\n--- Step 1: Initialize Test State ---");
    try {
      const tx = await program.methods
        .initialize()
        .accounts({
          authority: walletKeypair.publicKey,
          testState: testStatePDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("✅ Initialized! Tx:", tx);
    } catch (e) {
      console.log("❌ Failed to initialize:", e.message);
      return;
    }
  } else {
    console.log("✅ Test state already initialized");
  }

  // Test Inco CPI
  console.log("\n--- Step 2: Test Inco CPI (e_rand) ---");
  console.log("Calling test_inco_cpi instruction...");
  console.log("This will attempt to CPI to Inco Lightning's e_rand function.\n");

  try {
    const tx = await program.methods
      .testIncoCpi()
      .accounts({
        authority: walletKeypair.publicKey,
        testState: testStatePDA,
        incoProgram: INCO_LIGHTNING_PROGRAM_ID,
      })
      .rpc();

    console.log("╔══════════════════════════════════════════════════════════════════╗");
    console.log("║                    ✅ SUCCESS!                                   ║");
    console.log("║         Inco CPI works from our Solana program!                  ║");
    console.log("╚══════════════════════════════════════════════════════════════════╝");
    console.log("\nTransaction:", tx);

    // Fetch and display the result
    const testState = await program.account.testState.fetch(testStatePDA);
    console.log("\nTest State After CPI:");
    console.log("  - test_value:", testState.testValue.toString());
    console.log("  - inco_handle:", JSON.stringify(testState.incoHandle));
    console.log("  - test_completed:", testState.testCompleted);

    if (testState.testCompleted) {
      console.log("\n🎉 CONFIRMED: Inco e_rand() returned an encrypted handle!");
      // The handle is a BN object, extract the value
      const handleValue = testState.incoHandle.toString ? testState.incoHandle.toString() : testState.incoHandle;
      console.log("   Handle value:", handleValue);
    }

  } catch (e) {
    console.log("╔══════════════════════════════════════════════════════════════════╗");
    console.log("║                    ❌ FAILED                                     ║");
    console.log("║         Inco CPI did NOT work from our program                   ║");
    console.log("╚══════════════════════════════════════════════════════════════════╝");
    console.log("\nError:", e.message);

    if (e.logs) {
      console.log("\nProgram Logs:");
      e.logs.forEach(log => console.log("  ", log));
    }

    console.log("\n⚠️  This means we need to use an alternative architecture.");
    console.log("   Options:");
    console.log("   - Encrypt on base layer (after committing from ER)");
    console.log("   - Client-side encryption");
  }

  console.log("\n═══════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
