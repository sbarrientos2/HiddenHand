import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Hiddenhand } from "../target/types/hiddenhand";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction
} from "@solana/web3.js";
import { expect } from "chai";

describe("hiddenhand", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Hiddenhand as Program<Hiddenhand>;

  // Test constants
  const SMALL_BLIND = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
  const BIG_BLIND = 0.02 * LAMPORTS_PER_SOL;   // 0.02 SOL
  const MIN_BUY_IN = 1 * LAMPORTS_PER_SOL;     // 1 SOL (50 BB)
  const MAX_BUY_IN = 5 * LAMPORTS_PER_SOL;     // 5 SOL (250 BB)
  const MAX_PLAYERS = 6;

  // Helper to generate unique table ID
  function generateTableId(): number[] {
    return Array.from(Keypair.generate().publicKey.toBytes());
  }

  // Helper to derive table PDA
  function getTablePDA(tableId: number[]): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("table"), Buffer.from(tableId)],
      program.programId
    );
  }

  // Helper to derive vault PDA
  function getVaultPDA(table: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), table.toBuffer()],
      program.programId
    );
  }

  // Helper to derive player seat PDA
  function getSeatPDA(table: PublicKey, seatIndex: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("seat"), table.toBuffer(), Buffer.from([seatIndex])],
      program.programId
    );
  }

  // Helper to derive hand state PDA
  function getHandPDA(table: PublicKey, handNumber: number): [PublicKey, number] {
    const handNumberBuffer = Buffer.alloc(8);
    handNumberBuffer.writeBigUInt64LE(BigInt(handNumber));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("hand"), table.toBuffer(), handNumberBuffer],
      program.programId
    );
  }

  // Helper to derive deck state PDA
  function getDeckPDA(table: PublicKey, handNumber: number): [PublicKey, number] {
    const handNumberBuffer = Buffer.alloc(8);
    handNumberBuffer.writeBigUInt64LE(BigInt(handNumber));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("deck"), table.toBuffer(), handNumberBuffer],
      program.programId
    );
  }

  // Helper to airdrop SOL
  async function airdrop(address: PublicKey, amount: number = 10 * LAMPORTS_PER_SOL) {
    const sig = await provider.connection.requestAirdrop(address, amount);
    await provider.connection.confirmTransaction(sig);
  }

  // Helper to create a funded keypair
  async function createFundedKeypair(): Promise<Keypair> {
    const keypair = Keypair.generate();
    await airdrop(keypair.publicKey);
    return keypair;
  }

  describe("create_table", () => {
    it("creates a table with valid configuration", async () => {
      const tableId = generateTableId();
      const [tablePDA] = getTablePDA(tableId);
      const [vaultPDA] = getVaultPDA(tablePDA);

      await program.methods
        .createTable(
          tableId,
          new anchor.BN(SMALL_BLIND),
          new anchor.BN(BIG_BLIND),
          new anchor.BN(MIN_BUY_IN),
          new anchor.BN(MAX_BUY_IN),
          MAX_PLAYERS
        )
        .accounts({
          authority: provider.wallet.publicKey,
          table: tablePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const table = await program.account.table.fetch(tablePDA);

      expect(table.authority.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(table.smallBlind.toNumber()).to.equal(SMALL_BLIND);
      expect(table.bigBlind.toNumber()).to.equal(BIG_BLIND);
      expect(table.minBuyIn.toNumber()).to.equal(MIN_BUY_IN);
      expect(table.maxBuyIn.toNumber()).to.equal(MAX_BUY_IN);
      expect(table.maxPlayers).to.equal(MAX_PLAYERS);
      expect(table.currentPlayers).to.equal(0);
      expect(table.status).to.deep.equal({ waiting: {} });
      expect(table.handNumber.toNumber()).to.equal(0);
      expect(table.occupiedSeats).to.equal(0);
    });

    it("fails with max_players below minimum (2)", async () => {
      const tableId = generateTableId();
      const [tablePDA] = getTablePDA(tableId);
      const [vaultPDA] = getVaultPDA(tablePDA);

      try {
        await program.methods
          .createTable(
            tableId,
            new anchor.BN(SMALL_BLIND),
            new anchor.BN(BIG_BLIND),
            new anchor.BN(MIN_BUY_IN),
            new anchor.BN(MAX_BUY_IN),
            1 // Invalid: min is 2
          )
          .accounts({
            authority: provider.wallet.publicKey,
            table: tablePDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidSeatIndex");
      }
    });

    it("fails with max_players above maximum (6)", async () => {
      const tableId = generateTableId();
      const [tablePDA] = getTablePDA(tableId);
      const [vaultPDA] = getVaultPDA(tablePDA);

      try {
        await program.methods
          .createTable(
            tableId,
            new anchor.BN(SMALL_BLIND),
            new anchor.BN(BIG_BLIND),
            new anchor.BN(MIN_BUY_IN),
            new anchor.BN(MAX_BUY_IN),
            7 // Invalid: max is 6
          )
          .accounts({
            authority: provider.wallet.publicKey,
            table: tablePDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidSeatIndex");
      }
    });

    it("fails with big_blind less than small_blind", async () => {
      const tableId = generateTableId();
      const [tablePDA] = getTablePDA(tableId);
      const [vaultPDA] = getVaultPDA(tablePDA);

      try {
        await program.methods
          .createTable(
            tableId,
            new anchor.BN(BIG_BLIND), // Swapped
            new anchor.BN(SMALL_BLIND), // Swapped
            new anchor.BN(MIN_BUY_IN),
            new anchor.BN(MAX_BUY_IN),
            MAX_PLAYERS
          )
          .accounts({
            authority: provider.wallet.publicKey,
            table: tablePDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidBuyIn");
      }
    });

    it("fails with min_buy_in greater than max_buy_in", async () => {
      const tableId = generateTableId();
      const [tablePDA] = getTablePDA(tableId);
      const [vaultPDA] = getVaultPDA(tablePDA);

      try {
        await program.methods
          .createTable(
            tableId,
            new anchor.BN(SMALL_BLIND),
            new anchor.BN(BIG_BLIND),
            new anchor.BN(MAX_BUY_IN), // Swapped
            new anchor.BN(MIN_BUY_IN), // Swapped
            MAX_PLAYERS
          )
          .accounts({
            authority: provider.wallet.publicKey,
            table: tablePDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidBuyIn");
      }
    });

    it("fails with min_buy_in less than 10 big blinds", async () => {
      const tableId = generateTableId();
      const [tablePDA] = getTablePDA(tableId);
      const [vaultPDA] = getVaultPDA(tablePDA);

      try {
        await program.methods
          .createTable(
            tableId,
            new anchor.BN(SMALL_BLIND),
            new anchor.BN(BIG_BLIND),
            new anchor.BN(BIG_BLIND * 5), // Only 5 BB, need 10
            new anchor.BN(MAX_BUY_IN),
            MAX_PLAYERS
          )
          .accounts({
            authority: provider.wallet.publicKey,
            table: tablePDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidBuyIn");
      }
    });
  });

  describe("join_table", () => {
    let tableId: number[];
    let tablePDA: PublicKey;
    let vaultPDA: PublicKey;

    beforeEach(async () => {
      // Create a fresh table for each test
      tableId = generateTableId();
      [tablePDA] = getTablePDA(tableId);
      [vaultPDA] = getVaultPDA(tablePDA);

      await program.methods
        .createTable(
          tableId,
          new anchor.BN(SMALL_BLIND),
          new anchor.BN(BIG_BLIND),
          new anchor.BN(MIN_BUY_IN),
          new anchor.BN(MAX_BUY_IN),
          MAX_PLAYERS
        )
        .accounts({
          authority: provider.wallet.publicKey,
          table: tablePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("allows player to join with valid buy-in", async () => {
      const player = await createFundedKeypair();
      const seatIndex = 0;
      const [seatPDA] = getSeatPDA(tablePDA, seatIndex);
      const buyIn = MIN_BUY_IN;

      const vaultBalanceBefore = await provider.connection.getBalance(vaultPDA);

      await program.methods
        .joinTable(seatIndex, new anchor.BN(buyIn))
        .accounts({
          player: player.publicKey,
          table: tablePDA,
          playerSeat: seatPDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      const table = await program.account.table.fetch(tablePDA);
      expect(table.currentPlayers).to.equal(1);
      expect(table.occupiedSeats).to.equal(1); // Bit 0 set

      const seat = await program.account.playerSeat.fetch(seatPDA);
      expect(seat.player.toString()).to.equal(player.publicKey.toString());
      expect(seat.seatIndex).to.equal(seatIndex);
      expect(seat.chips.toNumber()).to.equal(buyIn);
      expect(seat.status).to.deep.equal({ sitting: {} });

      const vaultBalanceAfter = await provider.connection.getBalance(vaultPDA);
      expect(vaultBalanceAfter - vaultBalanceBefore).to.equal(buyIn);
    });

    it("allows multiple players to join different seats", async () => {
      const player1 = await createFundedKeypair();
      const player2 = await createFundedKeypair();

      const [seat0PDA] = getSeatPDA(tablePDA, 0);
      const [seat3PDA] = getSeatPDA(tablePDA, 3);

      await program.methods
        .joinTable(0, new anchor.BN(MIN_BUY_IN))
        .accounts({
          player: player1.publicKey,
          table: tablePDA,
          playerSeat: seat0PDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player1])
        .rpc();

      await program.methods
        .joinTable(3, new anchor.BN(MAX_BUY_IN))
        .accounts({
          player: player2.publicKey,
          table: tablePDA,
          playerSeat: seat3PDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player2])
        .rpc();

      const table = await program.account.table.fetch(tablePDA);
      expect(table.currentPlayers).to.equal(2);
      expect(table.occupiedSeats).to.equal(0b00001001); // Bits 0 and 3 set
    });

    it("fails with buy-in below minimum", async () => {
      const player = await createFundedKeypair();
      const [seatPDA] = getSeatPDA(tablePDA, 0);

      try {
        await program.methods
          .joinTable(0, new anchor.BN(MIN_BUY_IN - 1))
          .accounts({
            player: player.publicKey,
            table: tablePDA,
            playerSeat: seatPDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([player])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidBuyIn");
      }
    });

    it("fails with buy-in above maximum", async () => {
      const player = await createFundedKeypair();
      const [seatPDA] = getSeatPDA(tablePDA, 0);

      try {
        await program.methods
          .joinTable(0, new anchor.BN(MAX_BUY_IN + 1))
          .accounts({
            player: player.publicKey,
            table: tablePDA,
            playerSeat: seatPDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([player])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidBuyIn");
      }
    });

    it("fails with invalid seat index", async () => {
      const player = await createFundedKeypair();
      const [seatPDA] = getSeatPDA(tablePDA, MAX_PLAYERS); // Out of bounds

      try {
        await program.methods
          .joinTable(MAX_PLAYERS, new anchor.BN(MIN_BUY_IN))
          .accounts({
            player: player.publicKey,
            table: tablePDA,
            playerSeat: seatPDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([player])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidSeatIndex");
      }
    });

    it("fails when seat is already occupied", async () => {
      const player1 = await createFundedKeypair();
      const player2 = await createFundedKeypair();
      const [seatPDA] = getSeatPDA(tablePDA, 0);

      // First player joins seat 0
      await program.methods
        .joinTable(0, new anchor.BN(MIN_BUY_IN))
        .accounts({
          player: player1.publicKey,
          table: tablePDA,
          playerSeat: seatPDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player1])
        .rpc();

      // Second player tries same seat - will fail at PDA init
      try {
        await program.methods
          .joinTable(0, new anchor.BN(MIN_BUY_IN))
          .accounts({
            player: player2.publicKey,
            table: tablePDA,
            playerSeat: seatPDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([player2])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        // Account already exists error from Anchor
        expect(err.toString()).to.include("already in use");
      }
    });
  });

  describe("leave_table", () => {
    let tableId: number[];
    let tablePDA: PublicKey;
    let vaultPDA: PublicKey;

    beforeEach(async () => {
      tableId = generateTableId();
      [tablePDA] = getTablePDA(tableId);
      [vaultPDA] = getVaultPDA(tablePDA);

      await program.methods
        .createTable(
          tableId,
          new anchor.BN(SMALL_BLIND),
          new anchor.BN(BIG_BLIND),
          new anchor.BN(MIN_BUY_IN),
          new anchor.BN(MAX_BUY_IN),
          MAX_PLAYERS
        )
        .accounts({
          authority: provider.wallet.publicKey,
          table: tablePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("allows player to leave and receive chips back", async () => {
      const player = await createFundedKeypair();
      const [seatPDA] = getSeatPDA(tablePDA, 0);
      const buyIn = MIN_BUY_IN;

      // Join table
      await program.methods
        .joinTable(0, new anchor.BN(buyIn))
        .accounts({
          player: player.publicKey,
          table: tablePDA,
          playerSeat: seatPDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      const playerBalanceBefore = await provider.connection.getBalance(player.publicKey);

      // Leave table
      await program.methods
        .leaveTable()
        .accounts({
          player: player.publicKey,
          table: tablePDA,
          playerSeat: seatPDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      const playerBalanceAfter = await provider.connection.getBalance(player.publicKey);
      const table = await program.account.table.fetch(tablePDA);

      expect(table.currentPlayers).to.equal(0);
      expect(table.occupiedSeats).to.equal(0);

      // Player should have received chips back (minus tx fee, plus seat rent)
      // The seat account is closed and rent returned
      expect(playerBalanceAfter).to.be.greaterThan(playerBalanceBefore);

      // Seat account should be closed
      const seatAccount = await provider.connection.getAccountInfo(seatPDA);
      expect(seatAccount).to.be.null;
    });

    it("fails when trying to leave with wrong player", async () => {
      const player1 = await createFundedKeypair();
      const player2 = await createFundedKeypair();
      const [seatPDA] = getSeatPDA(tablePDA, 0);

      // Player 1 joins
      await program.methods
        .joinTable(0, new anchor.BN(MIN_BUY_IN))
        .accounts({
          player: player1.publicKey,
          table: tablePDA,
          playerSeat: seatPDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player1])
        .rpc();

      // Player 2 tries to leave player 1's seat
      try {
        await program.methods
          .leaveTable()
          .accounts({
            player: player2.publicKey,
            table: tablePDA,
            playerSeat: seatPDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([player2])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("PlayerNotAtTable");
      }
    });
  });

  describe("start_hand", () => {
    let tableId: number[];
    let tablePDA: PublicKey;
    let vaultPDA: PublicKey;
    let authority: Keypair;
    let player1: Keypair;
    let player2: Keypair;

    beforeEach(async () => {
      authority = await createFundedKeypair();
      player1 = await createFundedKeypair();
      player2 = await createFundedKeypair();

      tableId = generateTableId();
      [tablePDA] = getTablePDA(tableId);
      [vaultPDA] = getVaultPDA(tablePDA);

      // Create table with authority
      await program.methods
        .createTable(
          tableId,
          new anchor.BN(SMALL_BLIND),
          new anchor.BN(BIG_BLIND),
          new anchor.BN(MIN_BUY_IN),
          new anchor.BN(MAX_BUY_IN),
          MAX_PLAYERS
        )
        .accounts({
          authority: authority.publicKey,
          table: tablePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
    });

    it("starts a hand with 2 players", async () => {
      const [seat0PDA] = getSeatPDA(tablePDA, 0);
      const [seat1PDA] = getSeatPDA(tablePDA, 1);

      // Both players join
      await program.methods
        .joinTable(0, new anchor.BN(MIN_BUY_IN))
        .accounts({
          player: player1.publicKey,
          table: tablePDA,
          playerSeat: seat0PDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player1])
        .rpc();

      await program.methods
        .joinTable(1, new anchor.BN(MIN_BUY_IN))
        .accounts({
          player: player2.publicKey,
          table: tablePDA,
          playerSeat: seat1PDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player2])
        .rpc();

      // Start hand
      const [handPDA] = getHandPDA(tablePDA, 1);
      const [deckPDA] = getDeckPDA(tablePDA, 1);

      await program.methods
        .startHand()
        .accounts({
          authority: authority.publicKey,
          table: tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const table = await program.account.table.fetch(tablePDA);
      expect(table.status).to.deep.equal({ playing: {} });
      expect(table.handNumber.toNumber()).to.equal(1);

      const handState = await program.account.handState.fetch(handPDA);
      expect(handState.table.toString()).to.equal(tablePDA.toString());
      expect(handState.handNumber.toNumber()).to.equal(1);
      expect(handState.phase).to.deep.equal({ dealing: {} });
      expect(handState.pot.toNumber()).to.equal(0);
      expect(handState.currentBet.toNumber()).to.equal(BIG_BLIND);
      expect(handState.activeCount).to.equal(2);
    });

    it("fails with only 1 player", async () => {
      const [seat0PDA] = getSeatPDA(tablePDA, 0);

      // Only 1 player joins
      await program.methods
        .joinTable(0, new anchor.BN(MIN_BUY_IN))
        .accounts({
          player: player1.publicKey,
          table: tablePDA,
          playerSeat: seat0PDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player1])
        .rpc();

      const [handPDA] = getHandPDA(tablePDA, 1);
      const [deckPDA] = getDeckPDA(tablePDA, 1);

      try {
        await program.methods
          .startHand()
          .accounts({
            authority: authority.publicKey,
            table: tablePDA,
            handState: handPDA,
            deckState: deckPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("NotEnoughPlayers");
      }
    });

    it("fails when non-authority tries to start hand", async () => {
      const [seat0PDA] = getSeatPDA(tablePDA, 0);
      const [seat1PDA] = getSeatPDA(tablePDA, 1);

      await program.methods
        .joinTable(0, new anchor.BN(MIN_BUY_IN))
        .accounts({
          player: player1.publicKey,
          table: tablePDA,
          playerSeat: seat0PDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player1])
        .rpc();

      await program.methods
        .joinTable(1, new anchor.BN(MIN_BUY_IN))
        .accounts({
          player: player2.publicKey,
          table: tablePDA,
          playerSeat: seat1PDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player2])
        .rpc();

      const [handPDA] = getHandPDA(tablePDA, 1);
      const [deckPDA] = getDeckPDA(tablePDA, 1);

      // Player1 (not authority) tries to start
      try {
        await program.methods
          .startHand()
          .accounts({
            authority: player1.publicKey,
            table: tablePDA,
            handState: handPDA,
            deckState: deckPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([player1])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("UnauthorizedAuthority");
      }
    });
  });

  describe("player_action", () => {
    let tableId: number[];
    let tablePDA: PublicKey;
    let vaultPDA: PublicKey;
    let authority: Keypair;
    let player1: Keypair;
    let player2: Keypair;
    let seat0PDA: PublicKey;
    let seat1PDA: PublicKey;
    let handPDA: PublicKey;
    let deckPDA: PublicKey;

    beforeEach(async () => {
      authority = await createFundedKeypair();
      player1 = await createFundedKeypair();
      player2 = await createFundedKeypair();

      tableId = generateTableId();
      [tablePDA] = getTablePDA(tableId);
      [vaultPDA] = getVaultPDA(tablePDA);
      [seat0PDA] = getSeatPDA(tablePDA, 0);
      [seat1PDA] = getSeatPDA(tablePDA, 1);

      // Create table
      await program.methods
        .createTable(
          tableId,
          new anchor.BN(SMALL_BLIND),
          new anchor.BN(BIG_BLIND),
          new anchor.BN(MIN_BUY_IN),
          new anchor.BN(MAX_BUY_IN),
          MAX_PLAYERS
        )
        .accounts({
          authority: authority.publicKey,
          table: tablePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Players join
      await program.methods
        .joinTable(0, new anchor.BN(MIN_BUY_IN))
        .accounts({
          player: player1.publicKey,
          table: tablePDA,
          playerSeat: seat0PDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player1])
        .rpc();

      await program.methods
        .joinTable(1, new anchor.BN(MIN_BUY_IN))
        .accounts({
          player: player2.publicKey,
          table: tablePDA,
          playerSeat: seat1PDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player2])
        .rpc();

      // Start hand
      [handPDA] = getHandPDA(tablePDA, 1);
      [deckPDA] = getDeckPDA(tablePDA, 1);

      await program.methods
        .startHand()
        .accounts({
          authority: authority.publicKey,
          table: tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();
    });

    it("fails when hand not in betting phase", async () => {
      // Hand is in Dealing phase, not PreFlop
      const handState = await program.account.handState.fetch(handPDA);
      expect(handState.phase).to.deep.equal({ dealing: {} });

      const actionOnSeat = handState.actionOn;
      const actionPlayer = actionOnSeat === 0 ? player1 : player2;
      const actionSeatPDA = actionOnSeat === 0 ? seat0PDA : seat1PDA;

      try {
        await program.methods
          .playerAction({ check: {} })
          .accounts({
            player: actionPlayer.publicKey,
            table: tablePDA,
            handState: handPDA,
            playerSeat: actionSeatPDA,
          })
          .signers([actionPlayer])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidPhase");
      }
    });

    // Note: For full betting tests, we'd need to manually transition to PreFlop
    // This requires implementing mock card dealing or modifying the hand state
  });

  describe("betting actions (with manual phase setup)", () => {
    // These tests would require a way to manually set the hand to PreFlop phase
    // In production, this happens after dealing cards via Inco integration
    // For now, we document the expected behavior

    it.skip("allows call action when there is a bet to call", async () => {
      // Would need hand in PreFlop phase with current_bet > player's bet
    });

    it.skip("allows check when no bet to call", async () => {
      // Would need hand in Flop/Turn/River phase with current_bet == 0
    });

    it.skip("allows raise above minimum", async () => {
      // Would need hand in betting phase, raise >= min_raise
    });

    it.skip("fails raise below minimum", async () => {
      // Would need hand in betting phase
    });

    it.skip("allows all-in", async () => {
      // Would need hand in betting phase
    });

    it.skip("fold ends hand when only 1 player remains", async () => {
      // Would need 2 players, one folds
    });

    it.skip("advances phase when betting round complete", async () => {
      // Would need all players to act
    });
  });
});
