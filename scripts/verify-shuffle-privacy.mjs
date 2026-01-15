import { Connection, PublicKey } from "@solana/web3.js";

// MagicBlock Delegation Program
const DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

// Your program
const HIDDENHAND_PROGRAM_ID = new PublicKey("HS3GdhRBU3jMT4G6ogKVktKaibqsMhPRhDhNsmgzeB8Q");

// Seeds
const TABLE_SEED = Buffer.from("table");
const HAND_SEED = Buffer.from("hand");
const DECK_SEED = Buffer.from("deck");

function toLEBytes(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

// DeckState layout (NEW - with vrf_seed):
// - discriminator: 8 bytes
// - hand: 32 bytes (Pubkey)
// - cards: [u128; 52] = 52 * 16 = 832 bytes
// - deal_index: 1 byte
// - is_shuffled: 1 byte
// - vrf_seed: 32 bytes
// - seed_received: 1 byte
// - bump: 1 byte
// Total: 908 bytes

// DeckState layout (OLD - without vrf_seed):
// Total: 875 bytes

const NEW_DECK_SIZE = 908;
const OLD_DECK_SIZE = 875;

function decodeDeckState(data) {
  let offset = 8; // Skip discriminator
  const isNewLayout = data.length >= NEW_DECK_SIZE;

  // hand: Pubkey (32 bytes)
  const hand = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  // cards: [u128; 52] - read as u128 little-endian
  const cards = [];
  for (let i = 0; i < 52; i++) {
    // Read 16 bytes as little-endian u128
    // For simplicity, just read the first 8 bytes as u64 (cards are small numbers)
    const cardValue = data.readBigUInt64LE(offset);
    cards.push(Number(cardValue));
    offset += 16;
  }

  // deal_index: u8
  const dealIndex = data.readUInt8(offset);
  offset += 1;

  // is_shuffled: bool
  const isShuffled = data.readUInt8(offset) !== 0;
  offset += 1;

  let vrfSeed = null;
  let seedReceived = false;

  if (isNewLayout) {
    // vrf_seed: [u8; 32]
    vrfSeed = data.slice(offset, offset + 32);
    offset += 32;

    // seed_received: bool
    seedReceived = data.readUInt8(offset) !== 0;
    offset += 1;
  }

  // bump: u8
  const bump = data.readUInt8(offset);

  return {
    hand: hand.toString(),
    cards,
    dealIndex,
    isShuffled,
    vrfSeed: vrfSeed ? Buffer.from(vrfSeed).toString('hex') : null,
    seedReceived,
    bump,
    isNewLayout
  };
}

function isShuffledDeck(cards) {
  // Check if cards are in sequential order (0-51) = NOT shuffled
  for (let i = 0; i < 52; i++) {
    if (cards[i] !== i) {
      return true; // At least one card is out of place
    }
  }
  return false; // All cards in original order
}

function isUninitialized(cards) {
  // Check if all cards are 0 (uninitialized)
  return cards.every(c => c === 0);
}

async function verifyShufflePrivacy(tableId) {
  const baseConnection = new Connection("https://api.devnet.solana.com", "confirmed");
  const erConnection = new Connection("https://devnet.magicblock.app", "confirmed");

  // Derive table PDA
  const tableIdBuffer = Buffer.alloc(32);
  tableIdBuffer.write(tableId);
  const [tablePDA] = PublicKey.findProgramAddressSync(
    [TABLE_SEED, tableIdBuffer],
    HIDDENHAND_PROGRAM_ID
  );

  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║              SHUFFLE PRIVACY VERIFICATION                        ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");
  console.log("Table ID:", tableId);
  console.log("Table PDA:", tablePDA.toString());

  // Check table exists
  const tableAccount = await baseConnection.getAccountInfo(tablePDA);
  if (!tableAccount) {
    console.log("\n❌ Table not found on base layer");
    return;
  }

  // Check hand numbers 1-5
  for (let handNum = 1; handNum <= 5; handNum++) {
    const [handPDA] = PublicKey.findProgramAddressSync(
      [HAND_SEED, tablePDA.toBuffer(), toLEBytes(handNum)],
      HIDDENHAND_PROGRAM_ID
    );

    const [deckPDA] = PublicKey.findProgramAddressSync(
      [DECK_SEED, tablePDA.toBuffer(), toLEBytes(handNum)],
      HIDDENHAND_PROGRAM_ID
    );

    // Check if deck exists on base layer
    const deckOnBase = await baseConnection.getAccountInfo(deckPDA);
    if (!deckOnBase) continue;

    console.log(`\n┌─────────────────────────────────────────────────────────────────┐`);
    console.log(`│ Hand #${handNum}                                                      │`);
    console.log(`└─────────────────────────────────────────────────────────────────┘`);
    console.log("Deck PDA:", deckPDA.toString());

    const isDelegated = deckOnBase.owner.equals(DELEGATION_PROGRAM_ID);
    console.log("Base Layer Status:", isDelegated ? "🔒 DELEGATED" : "📍 On base layer");

    if (!isDelegated) {
      // Decode deck on base layer
      console.log("\n📊 BASE LAYER Deck State:");
      try {
        const deck = decodeDeckState(deckOnBase.data);
        console.log("  - Layout:", deck.isNewLayout ? "✅ NEW (with vrf_seed)" : "⚠️  OLD (pre-fix)");

        if (deck.isNewLayout) {
          console.log("  - seedReceived:", deck.seedReceived ? "✅ true" : "❌ false");
          console.log("  - vrfSeed (first 16 chars):", deck.vrfSeed ? deck.vrfSeed.slice(0, 16) + "..." : "null");
        }

        console.log("  - isShuffled:", deck.isShuffled ? "⚠️  true (PRIVACY LEAK!)" : "✅ false (safe)");
        console.log("  - dealIndex:", deck.dealIndex);

        // Analyze cards
        const cardsShuffled = isShuffledDeck(deck.cards);
        const cardsUninitialized = isUninitialized(deck.cards);

        if (cardsUninitialized) {
          console.log("  - cards: ✅ All zeros (uninitialized/private)");
        } else if (cardsShuffled) {
          console.log("  - cards: ⚠️  SHUFFLED ORDER VISIBLE!");
          console.log("  - First 10 cards:", deck.cards.slice(0, 10).join(", "));
          console.log("\n  ⛔ PRIVACY VIOLATION: Shuffled deck visible on base layer!");
        } else {
          console.log("  - cards: 📍 Sequential order (0-51, not yet shuffled)");
        }
      } catch (e) {
        console.log("  Error decoding:", e.message);
      }
    }

    // Check deck on ER
    const deckOnER = await erConnection.getAccountInfo(deckPDA);
    if (deckOnER) {
      console.log("\n🌐 EPHEMERAL ROLLUP Deck State:");
      try {
        const deck = decodeDeckState(deckOnER.data);
        console.log("  - Layout:", deck.isNewLayout ? "✅ NEW (with vrf_seed)" : "⚠️  OLD (pre-fix)");

        if (deck.isNewLayout) {
          console.log("  - seedReceived:", deck.seedReceived ? "✅ true" : "❌ false");
        }

        console.log("  - isShuffled:", deck.isShuffled ? "✅ true (shuffled on ER)" : "❌ false");
        console.log("  - dealIndex:", deck.dealIndex);

        const cardsShuffled = isShuffledDeck(deck.cards);
        if (cardsShuffled) {
          console.log("  - cards: ✅ Shuffled (private on ER)");
          console.log("  - First 10 cards:", deck.cards.slice(0, 10).join(", "));
        } else {
          console.log("  - cards: ❌ Not shuffled yet");
        }
      } catch (e) {
        console.log("  Error decoding:", e.message);
      }
    } else if (isDelegated) {
      console.log("\n🌐 Deck is delegated but not yet visible on ER query");
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("LEGEND:");
  console.log("  ✅ = Correct behavior (privacy preserved)");
  console.log("  ⚠️  = Privacy concern (card order visible)");
  console.log("  🔒 = Account delegated to MagicBlock ER");
  console.log("  📍 = Account on base Solana layer");
  console.log("═══════════════════════════════════════════════════════════════════\n");
}

// Get argument from command line
const tableId = process.argv[2] || "test";
verifyShufflePrivacy(tableId).catch(console.error);
