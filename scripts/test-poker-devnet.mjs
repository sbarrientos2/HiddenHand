#!/usr/bin/env node

/**
 * HiddenHand Poker - Devnet Test Script
 *
 * Tests the full poker flow on devnet:
 * 1. Create table
 * 2. Two players join
 * 3. Start hand
 * 4. Deal cards (legacy method - no VRF for simplicity)
 * 5. Player actions (call, check, fold)
 * 6. Showdown
 *
 * Run: node scripts/test-poker-devnet.mjs
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

function decodeCard(cardValue) {
  const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const suit = suits[Math.floor(cardValue / 13)];
  const rank = ranks[cardValue % 13];
  return `${rank} of ${suit}`;
}

async function main() {
  console.log("=".repeat(60));
  console.log("HiddenHand Poker - Devnet Test");
  console.log("=".repeat(60));

  // Setup connection
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load wallet
  const walletPath = process.env.HOME + "/.config/solana/id.json";
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const authority = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  console.log(`\nAuthority: ${authority.publicKey.toString()}`);

  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
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

  // Generate table ID
  const tableId = generateTableId();
  const [tablePDA] = getTablePDA(tableId);
  const [vaultPDA] = getVaultPDA(tablePDA);

  console.log(`\nTable PDA: ${tablePDA.toString()}`);
  console.log(`Vault PDA: ${vaultPDA.toString()}`);

  try {
    // Step 1: Create Table
    console.log("\n" + "=".repeat(60));
    console.log("Step 1: Creating Table...");
    console.log("=".repeat(60));

    const createTx = await program.methods
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

    console.log(`Table created! Tx: ${createTx}`);

    const table = await program.account.table.fetch(tablePDA);
    console.log(`  Small Blind: ${table.smallBlind.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`  Big Blind: ${table.bigBlind.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`  Status: ${JSON.stringify(table.status)}`);

    // Step 2: Two players join (authority plays both for testing)
    console.log("\n" + "=".repeat(60));
    console.log("Step 2: Players Joining...");
    console.log("=".repeat(60));

    // For testing, authority joins as both players (seat 0 and 1)
    const [seat0PDA] = getSeatPDA(tablePDA, 0);
    const [seat1PDA] = getSeatPDA(tablePDA, 1);

    const join1Tx = await program.methods
      .joinTable(0, new BN(MIN_BUY_IN))
      .accounts({
        player: authority.publicKey,
        table: tablePDA,
        playerSeat: seat0PDA,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`Player 1 joined seat 0! Tx: ${join1Tx}`);

    const join2Tx = await program.methods
      .joinTable(1, new BN(MIN_BUY_IN))
      .accounts({
        player: authority.publicKey,
        table: tablePDA,
        playerSeat: seat1PDA,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`Player 2 joined seat 1! Tx: ${join2Tx}`);

    const tableAfterJoin = await program.account.table.fetch(tablePDA);
    console.log(`  Current Players: ${tableAfterJoin.currentPlayers}`);

    // Step 3: Start Hand
    console.log("\n" + "=".repeat(60));
    console.log("Step 3: Starting Hand...");
    console.log("=".repeat(60));

    const [handPDA] = getHandPDA(tablePDA, 1);
    const [deckPDA] = getDeckPDA(tablePDA, 1);

    const startTx = await program.methods
      .startHand()
      .accounts({
        caller: authority.publicKey,
        table: tablePDA,
        handState: handPDA,
        deckState: deckPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`Hand started! Tx: ${startTx}`);

    const handState = await program.account.handState.fetch(handPDA);
    console.log(`  Hand Number: ${handState.handNumber.toNumber()}`);
    console.log(`  Phase: ${JSON.stringify(handState.phase)}`);

    // Step 4: Deal Cards
    console.log("\n" + "=".repeat(60));
    console.log("Step 4: Dealing Cards...");
    console.log("=".repeat(60));

    const dealTx = await program.methods
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

    console.log(`Cards dealt! Tx: ${dealTx}`);

    const handAfterDeal = await program.account.handState.fetch(handPDA);
    console.log(`  Phase: ${JSON.stringify(handAfterDeal.phase)}`);
    console.log(`  Pot: ${handAfterDeal.pot.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`  Current Bet: ${handAfterDeal.currentBet.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`  Action on Seat: ${handAfterDeal.actionOn}`);

    // Show hole cards
    const seat0 = await program.account.playerSeat.fetch(seat0PDA);
    const seat1 = await program.account.playerSeat.fetch(seat1PDA);

    console.log(`\n  Seat 0 Cards:`);
    console.log(`    Card 1: ${decodeCard(Number(seat0.holeCard1))} (${seat0.holeCard1})`);
    console.log(`    Card 2: ${decodeCard(Number(seat0.holeCard2))} (${seat0.holeCard2})`);
    console.log(`    Chips: ${seat0.chips.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`    Current Bet: ${seat0.currentBet.toNumber() / LAMPORTS_PER_SOL} SOL`);

    console.log(`  Seat 1 Cards:`);
    console.log(`    Card 1: ${decodeCard(Number(seat1.holeCard1))} (${seat1.holeCard1})`);
    console.log(`    Card 2: ${decodeCard(Number(seat1.holeCard2))} (${seat1.holeCard2})`);
    console.log(`    Chips: ${seat1.chips.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`    Current Bet: ${seat1.currentBet.toNumber() / LAMPORTS_PER_SOL} SOL`);

    // Step 5: Player Actions
    console.log("\n" + "=".repeat(60));
    console.log("Step 5: Player Actions...");
    console.log("=".repeat(60));

    // Helper to get the right action
    async function getPlayerAction(seatPDA, handState) {
      const seat = await program.account.playerSeat.fetch(seatPDA);
      const currentBet = handState.currentBet.toNumber();
      const playerBet = seat.currentBet.toNumber();

      if (playerBet >= currentBet) {
        return { check: {} };
      } else {
        return { call: {} };
      }
    }

    // First player action
    let currentHandState = await program.account.handState.fetch(handPDA);
    const firstActorSeat = currentHandState.actionOn;
    const firstActorPDA = firstActorSeat === 0 ? seat0PDA : seat1PDA;
    let action = await getPlayerAction(firstActorPDA, currentHandState);
    const actionName = Object.keys(action)[0];

    console.log(`\nSeat ${firstActorSeat} ${actionName}s...`);
    const action1Tx = await program.methods
      .playerAction(action)
      .accounts({
        player: authority.publicKey,
        table: tablePDA,
        handState: handPDA,
        deckState: deckPDA,
        playerSeat: firstActorPDA,
      })
      .rpc();
    console.log(`${actionName} successful! Tx: ${action1Tx}`);

    // Second player action
    currentHandState = await program.account.handState.fetch(handPDA);
    const secondActorSeat = currentHandState.actionOn;
    const secondActorPDA = secondActorSeat === 0 ? seat0PDA : seat1PDA;
    action = await getPlayerAction(secondActorPDA, currentHandState);
    const actionName2 = Object.keys(action)[0];

    console.log(`\nSeat ${secondActorSeat} ${actionName2}s...`);
    const action2Tx = await program.methods
      .playerAction(action)
      .accounts({
        player: authority.publicKey,
        table: tablePDA,
        handState: handPDA,
        deckState: deckPDA,
        playerSeat: secondActorPDA,
      })
      .rpc();
    console.log(`${actionName2} successful! Tx: ${action2Tx}`);

    // Continue through phases (the program auto-advances after betting rounds)
    currentHandState = await program.account.handState.fetch(handPDA);
    console.log(`\nAfter PreFlop actions:`);
    console.log(`  Phase: ${JSON.stringify(currentHandState.phase)}`);
    console.log(`  Pot: ${currentHandState.pot.toNumber() / LAMPORTS_PER_SOL} SOL`);

    // Check through remaining rounds if in Flop/Turn/River
    for (let round = 0; round < 6; round++) {
      currentHandState = await program.account.handState.fetch(handPDA);
      const phase = Object.keys(currentHandState.phase)[0];

      if (phase === "showdown" || phase === "settled") {
        console.log(`\nReached ${phase} phase!`);
        break;
      }

      const actorSeat = currentHandState.actionOn;
      const actorPDA = actorSeat === 0 ? seat0PDA : seat1PDA;

      console.log(`\n${phase.toUpperCase()} - Seat ${actorSeat} checks...`);
      try {
        await program.methods
          .playerAction({ check: {} })
          .accounts({
            player: authority.publicKey,
            table: tablePDA,
            handState: handPDA,
            deckState: deckPDA,
            playerSeat: actorPDA,
          })
          .rpc();
      } catch (err) {
        console.log(`  Action failed (might be at showdown): ${err.message}`);
        break;
      }
    }

    // Step 6: Showdown
    console.log("\n" + "=".repeat(60));
    console.log("Step 6: Showdown...");
    console.log("=".repeat(60));

    currentHandState = await program.account.handState.fetch(handPDA);
    const finalPhase = Object.keys(currentHandState.phase)[0];

    if (finalPhase === "showdown") {
      const showdownTx = await program.methods
        .showdown()
        .accounts({
          caller: authority.publicKey,
          table: tablePDA,
          handState: handPDA,
          vault: vaultPDA,
        })
        .remainingAccounts([
          { pubkey: seat0PDA, isSigner: false, isWritable: true },
          { pubkey: seat1PDA, isSigner: false, isWritable: true },
        ])
        .rpc();

      console.log(`Showdown complete! Tx: ${showdownTx}`);
    } else if (finalPhase === "settled") {
      console.log("Hand already settled (one player folded or all-in resolution)");
    } else {
      console.log(`Unexpected phase: ${finalPhase}`);
    }

    // Final state
    console.log("\n" + "=".repeat(60));
    console.log("Final State");
    console.log("=".repeat(60));

    const finalHandState = await program.account.handState.fetch(handPDA);
    const finalSeat0 = await program.account.playerSeat.fetch(seat0PDA);
    const finalSeat1 = await program.account.playerSeat.fetch(seat1PDA);

    console.log(`  Phase: ${JSON.stringify(finalHandState.phase)}`);
    console.log(`  Pot: ${finalHandState.pot.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`\n  Seat 0 Final Chips: ${finalSeat0.chips.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`  Seat 1 Final Chips: ${finalSeat1.chips.toNumber() / LAMPORTS_PER_SOL} SOL`);

    console.log("\n" + "=".repeat(60));
    console.log("TEST COMPLETE!");
    console.log("=".repeat(60));

  } catch (err) {
    console.error("\nError:", err);
    if (err.logs) {
      console.error("\nProgram Logs:");
      err.logs.forEach(log => console.error("  ", log));
    }
    process.exit(1);
  }
}

main();
