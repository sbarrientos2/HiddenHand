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

function toLEBytes(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

async function checkDelegationByPDA(tablePDAStr) {
  const baseConnection = new Connection("https://api.devnet.solana.com", "confirmed");
  const erConnection = new Connection("https://devnet.magicblock.app", "confirmed");

  const tablePDA = new PublicKey(tablePDAStr);

  console.log("\n=== Checking Delegation Status ===\n");
  console.log("Table PDA:", tablePDA.toString());

  // Check table account on base layer
  const tableAccount = await baseConnection.getAccountInfo(tablePDA);
  if (!tableAccount) {
    console.log("\n❌ Table not found on base layer");
    return;
  }

  console.log("\n--- Table (should always be on base layer) ---");
  console.log("Owner:", tableAccount.owner.toString());
  console.log("Is HiddenHand:", tableAccount.owner.equals(HIDDENHAND_PROGRAM_ID) ? "✅ Yes" : "❌ No");

  // Check hand numbers 1-3
  for (let handNum = 1; handNum <= 3; handNum++) {
    const [handPDA] = PublicKey.findProgramAddressSync(
      [HAND_SEED, tablePDA.toBuffer(), toLEBytes(handNum)],
      HIDDENHAND_PROGRAM_ID
    );

    const [deckPDA] = PublicKey.findProgramAddressSync(
      [DECK_SEED, tablePDA.toBuffer(), toLEBytes(handNum)],
      HIDDENHAND_PROGRAM_ID
    );

    // Check hand state
    console.log(`\n--- Hand #${handNum} ---`);
    console.log("Hand PDA:", handPDA.toString());

    const handOnBase = await baseConnection.getAccountInfo(handPDA);
    const handOnER = await erConnection.getAccountInfo(handPDA);

    if (handOnBase) {
      console.log("Base Layer Owner:", handOnBase.owner.toString());
      if (handOnBase.owner.equals(DELEGATION_PROGRAM_ID)) {
        console.log("🔒 DELEGATED to ER (owned by Delegation Program)");
      } else if (handOnBase.owner.equals(HIDDENHAND_PROGRAM_ID)) {
        console.log("📍 On base layer (owned by HiddenHand)");
      }
    } else {
      console.log("❌ Not found on base layer");
    }

    if (handOnER) {
      console.log("🌐 Present on Ephemeral Rollup, Owner:", handOnER.owner.toString());
    }

    // Check deck
    const deckOnBase = await baseConnection.getAccountInfo(deckPDA);
    if (deckOnBase) {
      console.log("Deck Owner:", deckOnBase.owner.toString());
      if (deckOnBase.owner.equals(DELEGATION_PROGRAM_ID)) {
        console.log("🔒 Deck DELEGATED to ER");
      } else {
        console.log("📍 Deck on base layer");
      }
    }
  }

  // Check seats 0-3
  console.log("\n--- Player Seats ---");
  for (let seatIdx = 0; seatIdx < 4; seatIdx++) {
    const [seatPDA] = PublicKey.findProgramAddressSync(
      [SEAT_SEED, tablePDA.toBuffer(), Buffer.from([seatIdx])],
      HIDDENHAND_PROGRAM_ID
    );

    const seatOnBase = await baseConnection.getAccountInfo(seatPDA);
    if (seatOnBase) {
      const isDelegated = seatOnBase.owner.equals(DELEGATION_PROGRAM_ID);
      console.log(`Seat ${seatIdx}: ${isDelegated ? "🔒 DELEGATED" : "📍 Base layer"} (${seatPDA.toString().slice(0,8)}...)`);
    }
  }

  console.log("\n=== Summary ===");
  console.log("🔒 = Account is DELEGATED to MagicBlock ER (privacy mode active)");
  console.log("📍 = Account is on base Solana layer (normal mode)");
  console.log("🌐 = Account exists on Ephemeral Rollup");
}

async function checkDelegationByTableId(tableId) {
  // Frontend uses 32 bytes for table ID, padded with zeros
  const tableIdBuffer = Buffer.alloc(32);
  tableIdBuffer.write(tableId);
  const [tablePDA] = PublicKey.findProgramAddressSync(
    [TABLE_SEED, tableIdBuffer],
    HIDDENHAND_PROGRAM_ID
  );
  console.log(`Derived Table PDA from ID "${tableId}": ${tablePDA.toString()}`);
  await checkDelegationByPDA(tablePDA.toString());
}

// Get argument from command line
const arg = process.argv[2] || "test";

// Check if it looks like a public key (base58, ~44 chars)
if (arg.length >= 32 && arg.length <= 44 && !arg.includes(" ")) {
  try {
    new PublicKey(arg); // Validate it's a valid pubkey
    checkDelegationByPDA(arg).catch(console.error);
  } catch {
    // Not a valid pubkey, treat as table ID
    checkDelegationByTableId(arg).catch(console.error);
  }
} else {
  checkDelegationByTableId(arg).catch(console.error);
}
