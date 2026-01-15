import { Connection, PublicKey } from "@solana/web3.js";

// MagicBlock Delegation Program
const DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

// Your program
const HIDDENHAND_PROGRAM_ID = new PublicKey("HS3GdhRBU3jMT4G6ogKVktKaibqsMhPRhDhNsmgzeB8Q");

// Seeds
const TABLE_SEED = Buffer.from("table");
const HAND_SEED = Buffer.from("hand");
const DECK_SEED = Buffer.from("deck");
const SEAT_SEED = Buffer.from("seat");

async function checkDelegation(tableId: string) {
  const baseConnection = new Connection("https://api.devnet.solana.com", "confirmed");
  const erConnection = new Connection("https://devnet.magicblock.app", "confirmed");

  // Derive table PDA
  const tableIdBytes = new TextEncoder().encode(tableId.padEnd(16, "\0")).slice(0, 16);
  const [tablePDA] = PublicKey.findProgramAddressSync(
    [TABLE_SEED, tableIdBytes],
    HIDDENHAND_PROGRAM_ID
  );

  console.log("\n=== Checking Delegation Status ===\n");
  console.log("Table ID:", tableId);
  console.log("Table PDA:", tablePDA.toString());

  // Check table account
  const tableAccount = await baseConnection.getAccountInfo(tablePDA);
  if (!tableAccount) {
    console.log("\n❌ Table not found on base layer");
    return;
  }

  console.log("\n--- Table (should always be on base layer) ---");
  console.log("Owner:", tableAccount.owner.toString());
  console.log("Is HiddenHand:", tableAccount.owner.equals(HIDDENHAND_PROGRAM_ID) ? "✅ Yes" : "❌ No");

  // Parse hand number from table data (offset depends on struct layout)
  // For now, let's try hand number 1
  const handNumber = 1n;

  // Derive hand and deck PDAs
  const [handPDA] = PublicKey.findProgramAddressSync(
    [HAND_SEED, tablePDA.toBuffer(), Buffer.from(handNumber.toString(16).padStart(16, "0"), "hex").reverse()],
    HIDDENHAND_PROGRAM_ID
  );

  const [deckPDA] = PublicKey.findProgramAddressSync(
    [DECK_SEED, tablePDA.toBuffer(), Buffer.from(handNumber.toString(16).padStart(16, "0"), "hex").reverse()],
    HIDDENHAND_PROGRAM_ID
  );

  // Check hand state
  console.log("\n--- Hand State (hand #1) ---");
  console.log("Hand PDA:", handPDA.toString());

  let handOnBase = await baseConnection.getAccountInfo(handPDA);
  let handOnER = await erConnection.getAccountInfo(handPDA);

  if (handOnBase) {
    console.log("Base Layer Owner:", handOnBase.owner.toString());
    if (handOnBase.owner.equals(DELEGATION_PROGRAM_ID)) {
      console.log("🔒 DELEGATED to ER (owned by Delegation Program)");
    } else if (handOnBase.owner.equals(HIDDENHAND_PROGRAM_ID)) {
      console.log("📍 On base layer (owned by HiddenHand)");
    }
  } else {
    console.log("Not found on base layer");
  }

  if (handOnER) {
    console.log("ER Owner:", handOnER.owner.toString());
    console.log("🌐 Present on Ephemeral Rollup");
  }

  // Check deck state
  console.log("\n--- Deck State (hand #1) ---");
  console.log("Deck PDA:", deckPDA.toString());

  let deckOnBase = await baseConnection.getAccountInfo(deckPDA);
  let deckOnER = await erConnection.getAccountInfo(deckPDA);

  if (deckOnBase) {
    console.log("Base Layer Owner:", deckOnBase.owner.toString());
    if (deckOnBase.owner.equals(DELEGATION_PROGRAM_ID)) {
      console.log("🔒 DELEGATED to ER");
    } else if (deckOnBase.owner.equals(HIDDENHAND_PROGRAM_ID)) {
      console.log("📍 On base layer");
    }
  } else {
    console.log("Not found on base layer");
  }

  // Check seat 0
  const [seat0PDA] = PublicKey.findProgramAddressSync(
    [SEAT_SEED, tablePDA.toBuffer(), Buffer.from([0])],
    HIDDENHAND_PROGRAM_ID
  );

  console.log("\n--- Seat 0 ---");
  console.log("Seat PDA:", seat0PDA.toString());

  let seatOnBase = await baseConnection.getAccountInfo(seat0PDA);
  let seatOnER = await erConnection.getAccountInfo(seat0PDA);

  if (seatOnBase) {
    console.log("Base Layer Owner:", seatOnBase.owner.toString());
    if (seatOnBase.owner.equals(DELEGATION_PROGRAM_ID)) {
      console.log("🔒 DELEGATED to ER");
    } else if (seatOnBase.owner.equals(HIDDENHAND_PROGRAM_ID)) {
      console.log("📍 On base layer");
    }
  } else {
    console.log("Not found on base layer");
  }

  console.log("\n=== Summary ===");
  console.log("If accounts show '🔒 DELEGATED', privacy mode is active and MagicBlock ER is being used.");
  console.log("If accounts show '📍 On base layer', game is running normally without privacy.");
}

// Get table ID from command line
const tableId = process.argv[2] || "test";
checkDelegation(tableId).catch(console.error);
