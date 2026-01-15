#!/usr/bin/env node

/**
 * Test Script: Encrypt Hole Cards via Inco (Two-Phase)
 *
 * Tests the two-phase Inco encryption flow:
 * Phase 1: encrypt_hole_cards - Encrypts plaintext cards (0-51) via Inco CPI
 * Phase 2: grant_card_allowance - Grants allowances to players to decrypt
 *
 * The split is necessary because allowance PDAs depend on the encrypted handles,
 * which we don't know until AFTER encryption.
 *
 * Run: node scripts/test-encrypt-cards.mjs
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
const INCO_PROGRAM_ID = new PublicKey("5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj");
const SMALL_BLIND = 0.01 * LAMPORTS_PER_SOL;
const BIG_BLIND = 0.02 * LAMPORTS_PER_SOL;
const MIN_BUY_IN = 0.5 * LAMPORTS_PER_SOL;
const MAX_BUY_IN = 2 * LAMPORTS_PER_SOL;
const MAX_PLAYERS = 6;

// PDA helpers
function generateTableId(name) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(name);
  const tableId = new Uint8Array(32);
  tableId.set(bytes.slice(0, 32));
  return tableId;
}

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
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(handNumber));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("hand"), table.toBuffer(), buf],
    PROGRAM_ID
  );
}

function getDeckPDA(table, handNumber) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(handNumber));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deck"), table.toBuffer(), buf],
    PROGRAM_ID
  );
}

// Derive Inco allowance PDA from encrypted handle
// Seeds: [handle_le_bytes, player_pubkey] (NO "allowance" prefix!)
function getAllowancePDA(handle, playerPubkey) {
  // Convert BigInt handle to 16-byte little-endian buffer
  const handleBuf = Buffer.alloc(16);
  let h = BigInt(handle.toString());
  for (let i = 0; i < 16; i++) {
    handleBuf[i] = Number(h & 0xFFn);
    h >>= 8n;
  }
  return PublicKey.findProgramAddressSync(
    [handleBuf, playerPubkey.toBuffer()],
    INCO_PROGRAM_ID
  );
}

function decodeCard(val) {
  if (val === 255 || val > 51) return `encrypted(${val})`;
  const suits = ["♥", "♦", "♣", "♠"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  return ranks[val % 13] + suits[Math.floor(val / 13)];
}

async function main() {
  console.log("═".repeat(60));
  console.log("Inco Encryption Test - encrypt_hole_cards");
  console.log("═".repeat(60));

  // Setup connection
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load wallet
  const walletPath = process.env.HOME + "/.config/solana/id.json";
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  console.log(`\nAuthority: ${authority.publicKey.toString()}`);

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

  // Use a unique table name for this test
  const tableName = `inco-test-${Date.now()}`;
  const tableIdBytes = generateTableId(tableName);
  const [tablePDA] = getTablePDA(tableIdBytes);
  const [vaultPDA] = getVaultPDA(tablePDA);

  console.log(`\nTable: "${tableName}"`);
  console.log(`Table PDA: ${tablePDA.toString()}`);

  try {
    // Step 1: Create Table
    console.log("\n" + "-".repeat(40));
    console.log("Step 1: Creating table...");
    await program.methods
      .createTable(
        Array.from(tableIdBytes),
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
    console.log("  ✓ Table created");

    // Step 2: Join table (2 players)
    console.log("\nStep 2: Joining table (2 players)...");
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
    console.log("  ✓ 2 players joined");

    // Step 3: Start hand
    console.log("\nStep 3: Starting hand...");
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
    console.log("  ✓ Hand started");

    // Step 4: Deal cards (non-VRF for simplicity)
    console.log("\nStep 4: Dealing cards...");
    await program.methods
      .dealCards()
      .accounts({
        caller: authority.publicKey,
        table: tablePDA,
        handState: handPDA,
        deckState: deckPDA,
        sbSeat: seat0PDA,
        bbSeat: seat1PDA,
      })
      .rpc();
    console.log("  ✓ Cards dealt");

    // Check cards before encryption
    const seatBefore = await program.account.playerSeat.fetch(seat0PDA);
    console.log(`\n  Seat 0 cards (before encryption):`);
    console.log(`    Card 1: ${decodeCard(Number(seatBefore.holeCard1))} (${seatBefore.holeCard1.toString()})`);
    console.log(`    Card 2: ${decodeCard(Number(seatBefore.holeCard2))} (${seatBefore.holeCard2.toString()})`);

    // Step 5: Phase 1 - Encrypt hole cards (stores handles)
    console.log("\n" + "-".repeat(40));
    console.log("Step 5: Phase 1 - Encrypting hole cards via Inco...");

    console.log(`  Attempting encryption for seat 0...`);
    console.log(`  Inco Program: ${INCO_PROGRAM_ID.toString()}`);

    try {
      const encryptTx = await program.methods
        .encryptHoleCards(0)
        .accounts({
          authority: authority.publicKey,
          table: tablePDA,
          handState: handPDA,
          playerSeat: seat0PDA,
          incoProgram: INCO_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`  ✓ Phase 1 complete! Tx: ${encryptTx}`);

      // Check cards after encryption
      const seatAfterEncrypt = await program.account.playerSeat.fetch(seat0PDA);
      const handle1 = seatAfterEncrypt.holeCard1;
      const handle2 = seatAfterEncrypt.holeCard2;
      console.log(`\n  Seat 0 cards (after encryption):`);
      console.log(`    Card 1 handle: ${handle1.toString()}`);
      console.log(`    Card 2 handle: ${handle2.toString()}`);

      if (handle1.gt(new BN(51))) {
        console.log("\n  🎉 SUCCESS! Cards are now encrypted handles!");

        // Step 6: Phase 2 - Grant allowances
        console.log("\n" + "-".repeat(40));
        console.log("Step 6: Phase 2 - Granting decryption allowances...");

        // Derive allowance PDAs from the encrypted handles
        const [allowancePDA1] = getAllowancePDA(handle1, authority.publicKey);
        const [allowancePDA2] = getAllowancePDA(handle2, authority.publicKey);

        console.log(`  Allowance PDA 1: ${allowancePDA1.toString()}`);
        console.log(`  Allowance PDA 2: ${allowancePDA2.toString()}`);

        const allowanceTx = await program.methods
          .grantCardAllowance(0)
          .accounts({
            authority: authority.publicKey,
            table: tablePDA,
            playerSeat: seat0PDA,
            allowanceCard1: allowancePDA1,
            allowanceCard2: allowancePDA2,
            player: authority.publicKey,
            incoProgram: INCO_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log(`  ✓ Phase 2 complete! Tx: ${allowanceTx}`);
        console.log("\n  🎉 FULL SUCCESS! Player can now decrypt their cards!");
      } else {
        console.log("\n  ⚠ Cards not encrypted (handles <= 51). Inco CPI may have failed silently.");
      }

    } catch (encryptErr) {
      console.log(`  ✗ Encryption failed!`);
      console.log(`\n  Error: ${encryptErr.message}`);

      if (encryptErr.logs) {
        console.log("\n  Program Logs:");
        encryptErr.logs.forEach(log => {
          if (log.includes("Error") || log.includes("failed") || log.includes("Inco") || log.includes("encrypt")) {
            console.log(`    ${log}`);
          }
        });
      }

      console.log("\n  This might mean:");
      console.log("    1. Inco program is not available on devnet");
      console.log("    2. Inco's as_euint128 CPI failed");
      console.log("    3. Return data parsing issue");
    }

    console.log("\n" + "═".repeat(60));

  } catch (err) {
    console.error("\nError:", err.message);
    if (err.logs) {
      console.error("\nProgram Logs:");
      err.logs.forEach(log => console.error("  ", log));
    }
  }
}

main();
