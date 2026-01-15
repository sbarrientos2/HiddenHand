#!/usr/bin/env node

/**
 * Independent VRF Oracle Test
 *
 * Tests the MagicBlock VRF oracle by:
 * 1. Creating a table + starting a hand (creates deck state)
 * 2. Requesting VRF shuffle
 * 3. Waiting for callback
 * 4. Checking if seedReceived is true
 *
 * Run: node scripts/test-vrf-oracle.mjs
 */

import pkg from "@coral-xyz/anchor";
const { AnchorProvider, Program, Wallet, BN } = pkg;
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load IDL
const idlPath = path.join(__dirname, "../target/idl/hiddenhand.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

// Constants
const PROGRAM_ID = new PublicKey("HS3GdhRBU3jMT4G6ogKVktKaibqsMhPRhDhNsmgzeB8Q");
const VRF_ORACLE_QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
const SMALL_BLIND = 0.01 * LAMPORTS_PER_SOL;
const BIG_BLIND = 0.02 * LAMPORTS_PER_SOL;
const MIN_BUY_IN = 0.5 * LAMPORTS_PER_SOL;
const MAX_BUY_IN = 2 * LAMPORTS_PER_SOL;
const MAX_PLAYERS = 6;

// PDA helpers
function getTablePDA(tableId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("table"), Buffer.from(tableId)],
    PROGRAM_ID
  );
}

function getVaultPDA(table) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), table.toBuffer()],
    PROGRAM_ID
  );
}

function getSeatPDA(table, seatIndex) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("seat"), table.toBuffer(), Buffer.from([seatIndex])],
    PROGRAM_ID
  );
}

function getHandPDA(table, handNumber) {
  const handNumberBuffer = Buffer.alloc(8);
  handNumberBuffer.writeBigUInt64LE(BigInt(handNumber));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("hand"), table.toBuffer(), handNumberBuffer],
    PROGRAM_ID
  );
}

function getDeckPDA(table, handNumber) {
  const handNumberBuffer = Buffer.alloc(8);
  handNumberBuffer.writeBigUInt64LE(BigInt(handNumber));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deck"), table.toBuffer(), handNumberBuffer],
    PROGRAM_ID
  );
}

function generateTableId() {
  return Array.from(Keypair.generate().publicKey.toBytes());
}

async function waitForVrfCallback(connection, deckPDA, timeout = 60000, pollInterval = 1000) {
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < timeout) {
    attempts++;
    try {
      const accountInfo = await connection.getAccountInfo(deckPDA);
      if (accountInfo) {
        // DeckState layout: discriminator(8) + hand(32) + cards(varies) + deal_index(1) + is_shuffled(1) + vrf_seed(32) + seed_received(1)
        // The seed_received boolean is near the end
        const data = accountInfo.data;

        // Check seed_received - it should be at a known offset
        // Let's just check if the account data has changed to indicate VRF received
        // A simpler check: look for non-zero bytes in the VRF seed area
        const vrfSeedStart = data.length - 33; // seed_received(1) + vrf_seed(32) at end
        const seedReceivedOffset = data.length - 1;

        const seedReceived = data[seedReceivedOffset] === 1;

        if (seedReceived) {
          console.log(`  VRF callback received after ${attempts} attempts (${Date.now() - startTime}ms)`);
          return true;
        }
      }
    } catch (e) {
      // Account might not exist yet
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
    process.stdout.write(`\r  Polling... attempt ${attempts} (${Math.floor((Date.now() - startTime) / 1000)}s elapsed)`);
  }

  console.log(`\n  VRF callback NOT received after ${timeout}ms`);
  return false;
}

async function main() {
  console.log("=".repeat(60));
  console.log("MagicBlock VRF Oracle Test");
  console.log("=".repeat(60));
  console.log(`\nVRF Oracle Queue: ${VRF_ORACLE_QUEUE.toString()}`);

  // Setup connection
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load wallet
  const walletPath = process.env.HOME + "/.config/solana/id.json";
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  console.log(`Authority: ${authority.publicKey.toString()}`);

  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 1 * LAMPORTS_PER_SOL) {
    console.log("\nInsufficient balance. Please airdrop SOL:");
    console.log("  solana airdrop 2");
    process.exit(1);
  }

  // Setup Anchor provider
  const wallet = new Wallet(authority);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  pkg.setProvider(provider);

  const program = new Program(idl, provider);

  // Generate unique table ID for this test
  const tableId = generateTableId();
  const [tablePDA] = getTablePDA(tableId);
  const [vaultPDA] = getVaultPDA(tablePDA);

  console.log(`\nTest Table PDA: ${tablePDA.toString()}`);

  try {
    // Step 1: Create Table
    console.log("\n" + "=".repeat(60));
    console.log("Step 1: Creating test table...");
    console.log("=".repeat(60));

    await program.methods
      .createTable(
        tableId,
        new BN(SMALL_BLIND),
        new BN(BIG_BLIND),
        new BN(MIN_BUY_IN),
        new BN(MAX_BUY_IN),
        MAX_PLAYERS
      )
      .accounts({
        authority: authority.publicKey,
        table: tablePDA,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  Table created!");

    // Step 2: Join with 2 players (same wallet for test)
    console.log("\n" + "=".repeat(60));
    console.log("Step 2: Joining table (2 players)...");
    console.log("=".repeat(60));

    const [seat0PDA] = getSeatPDA(tablePDA, 0);
    const [seat1PDA] = getSeatPDA(tablePDA, 1);

    await program.methods
      .joinTable(0, new BN(MIN_BUY_IN))
      .accounts({
        player: authority.publicKey,
        table: tablePDA,
        playerSeat: seat0PDA,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .joinTable(1, new BN(MIN_BUY_IN))
      .accounts({
        player: authority.publicKey,
        table: tablePDA,
        playerSeat: seat1PDA,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  2 players joined!");

    // Step 3: Start Hand
    console.log("\n" + "=".repeat(60));
    console.log("Step 3: Starting hand...");
    console.log("=".repeat(60));

    const [handPDA] = getHandPDA(tablePDA, 1);
    const [deckPDA] = getDeckPDA(tablePDA, 1);

    await program.methods
      .startHand()
      .accounts({
        caller: authority.publicKey,
        table: tablePDA,
        handState: handPDA,
        deckState: deckPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  Hand started!");
    console.log(`  Deck PDA: ${deckPDA.toString()}`);

    // Step 4: Request VRF Shuffle
    console.log("\n" + "=".repeat(60));
    console.log("Step 4: Requesting VRF shuffle...");
    console.log("=".repeat(60));

    const requestTx = await program.methods
      .requestShuffle()
      .accounts({
        authority: authority.publicKey,
        table: tablePDA,
        handState: handPDA,
        deckState: deckPDA,
        oracleQueue: VRF_ORACLE_QUEUE,
      })
      .rpc();

    console.log(`  VRF request sent! Tx: ${requestTx}`);
    console.log(`  Explorer: https://explorer.solana.com/tx/${requestTx}?cluster=devnet`);

    // Step 5: Wait for callback
    console.log("\n" + "=".repeat(60));
    console.log("Step 5: Waiting for VRF callback (max 60s)...");
    console.log("=".repeat(60));

    const received = await waitForVrfCallback(connection, deckPDA, 60000, 1000);

    // Check final state
    console.log("\n" + "=".repeat(60));
    console.log("Results");
    console.log("=".repeat(60));

    const deckState = await program.account.deckState.fetch(deckPDA);
    console.log(`  seedReceived: ${deckState.seedReceived}`);
    console.log(`  isShuffled: ${deckState.isShuffled}`);

    if (deckState.seedReceived) {
      const seed = deckState.vrfSeed;
      console.log(`  vrfSeed (first 8 bytes): [${seed.slice(0, 8).join(", ")}]`);
      console.log("\n✅ VRF ORACLE IS WORKING!");
    } else {
      console.log("\n❌ VRF ORACLE DID NOT RESPOND");
      console.log("  This could be:");
      console.log("  - Oracle is temporarily busy");
      console.log("  - Network congestion");
      console.log("  - Oracle service is down");
    }

  } catch (err) {
    console.error("\nError:", err.message);
    if (err.logs) {
      console.error("\nProgram Logs:");
      err.logs.forEach(log => console.error("  ", log));
    }
    process.exit(1);
  }
}

main();
