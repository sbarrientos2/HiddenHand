import { PublicKey } from "@solana/web3.js";

// Program ID from Anchor.toml
export const PROGRAM_ID = new PublicKey(
  "7skCDLugS15d6cfrtZZCc5rpe5sDB998WjVBacP5qsTp"
);

// PDA Seeds
const TABLE_SEED = Buffer.from("table");
const SEAT_SEED = Buffer.from("seat");
const HAND_SEED = Buffer.from("hand");
const DECK_SEED = Buffer.from("deck");
const VAULT_SEED = Buffer.from("vault");

/**
 * Derive Table PDA from table_id
 * Seeds: ["table", table_id[32]]
 */
export function getTablePDA(tableId: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TABLE_SEED, tableId],
    PROGRAM_ID
  );
}

/**
 * Derive PlayerSeat PDA
 * Seeds: ["seat", table_pubkey, seat_index_u8]
 */
export function getSeatPDA(
  table: PublicKey,
  seatIndex: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEAT_SEED, table.toBuffer(), Buffer.from([seatIndex])],
    PROGRAM_ID
  );
}

/**
 * Derive HandState PDA
 * Seeds: ["hand", table_pubkey, hand_number_u64_le]
 */
export function getHandPDA(
  table: PublicKey,
  handNumber: bigint
): [PublicKey, number] {
  const handNumberBuffer = Buffer.alloc(8);
  handNumberBuffer.writeBigUInt64LE(handNumber);
  return PublicKey.findProgramAddressSync(
    [HAND_SEED, table.toBuffer(), handNumberBuffer],
    PROGRAM_ID
  );
}

/**
 * Derive DeckState PDA
 * Seeds: ["deck", table_pubkey, hand_number_u64_le]
 */
export function getDeckPDA(
  table: PublicKey,
  handNumber: bigint
): [PublicKey, number] {
  const handNumberBuffer = Buffer.alloc(8);
  handNumberBuffer.writeBigUInt64LE(handNumber);
  return PublicKey.findProgramAddressSync(
    [DECK_SEED, table.toBuffer(), handNumberBuffer],
    PROGRAM_ID
  );
}

/**
 * Derive Vault PDA (holds player buy-ins)
 * Seeds: ["vault", table_pubkey]
 */
export function getVaultPDA(table: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, table.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Generate a table ID from a string (SHA256 hash padded/truncated to 32 bytes)
 */
export function generateTableId(name: string): Uint8Array {
  // Simple hash: use the string bytes padded to 32 bytes
  const encoder = new TextEncoder();
  const bytes = encoder.encode(name);
  const tableId = new Uint8Array(32);
  tableId.set(bytes.slice(0, 32));
  return tableId;
}

/**
 * Convert a table ID to a readable string (for display)
 */
export function tableIdToString(tableId: Uint8Array): string {
  const decoder = new TextDecoder();
  // Find the first null byte to trim
  let end = tableId.indexOf(0);
  if (end === -1) end = tableId.length;
  return decoder.decode(tableId.slice(0, end));
}
