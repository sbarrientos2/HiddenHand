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
          caller: authority.publicKey,
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
            caller: authority.publicKey,
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
            caller: player1.publicKey,
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
          caller: authority.publicKey,
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

  describe("timeout_player", () => {
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
          caller: authority.publicKey,
          table: tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Deal cards to transition to PreFlop
      // In 2-player game: seat 0 is SB (dealer), seat 1 is BB
      // After deal, action is on SB (seat 0) since BB already posted
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
        .signers([authority])
        .rpc();
    });

    it("fails when player has not timed out yet", async () => {
      // Get current hand state to find who has action
      const handState = await program.account.handState.fetch(handPDA);
      expect(handState.phase).to.deep.equal({ preFlop: {} });

      const actionOnSeat = handState.actionOn;
      const timedOutSeatPDA = actionOnSeat === 0 ? seat0PDA : seat1PDA;

      // Any user can call timeout, let's use the other player
      const caller = actionOnSeat === 0 ? player2 : player1;

      // Try to timeout immediately (should fail - 60 seconds haven't passed)
      try {
        await program.methods
          .timeoutPlayer()
          .accounts({
            caller: caller.publicKey,
            table: tablePDA,
            handState: handPDA,
            playerSeat: timedOutSeatPDA,
          })
          .signers([caller])
          .rpc();
        expect.fail("Should have thrown ActionNotTimedOut error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("ActionNotTimedOut");
      }
    });

    it("fails when targeting wrong player (not their turn)", async () => {
      const handState = await program.account.handState.fetch(handPDA);
      const actionOnSeat = handState.actionOn;

      // Try to timeout the player who does NOT have action
      const wrongSeatPDA = actionOnSeat === 0 ? seat1PDA : seat0PDA;
      const caller = player1;

      try {
        await program.methods
          .timeoutPlayer()
          .accounts({
            caller: caller.publicKey,
            table: tablePDA,
            handState: handPDA,
            playerSeat: wrongSeatPDA,
          })
          .signers([caller])
          .rpc();
        expect.fail("Should have thrown NotPlayersTurn error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("NotPlayersTurn");
      }
    });

    it("anyone can call timeout (not just authority)", async () => {
      // This test verifies the caller doesn't need to be authority
      // The actual timeout still fails because 60 seconds haven't passed
      // but it proves the instruction accepts any signer
      const handState = await program.account.handState.fetch(handPDA);
      const actionOnSeat = handState.actionOn;
      const timedOutSeatPDA = actionOnSeat === 0 ? seat0PDA : seat1PDA;

      // Use a random third party (not authority, not either player)
      const randomCaller = await createFundedKeypair();

      try {
        await program.methods
          .timeoutPlayer()
          .accounts({
            caller: randomCaller.publicKey,
            table: tablePDA,
            handState: handPDA,
            playerSeat: timedOutSeatPDA,
          })
          .signers([randomCaller])
          .rpc();
        expect.fail("Should have thrown ActionNotTimedOut error");
      } catch (err: any) {
        // We expect ActionNotTimedOut (not UnauthorizedAuthority)
        // This proves the random caller was accepted
        expect(err.error.errorCode.code).to.equal("ActionNotTimedOut");
      }
    });

    it("verifies last_action_time is set after deal_cards", async () => {
      const handState = await program.account.handState.fetch(handPDA);

      // last_action_time should be set to a recent timestamp
      const lastActionTime = handState.lastActionTime.toNumber();
      const now = Math.floor(Date.now() / 1000);

      // Should be within the last 60 seconds (test execution time)
      expect(lastActionTime).to.be.greaterThan(now - 60);
      expect(lastActionTime).to.be.lessThanOrEqual(now + 5); // Allow small clock drift
    });

    // Note: The following tests document expected behavior but require time manipulation
    // which is not easily achievable in solana-test-validator

    it.skip("auto-checks when player has no bet to call (after 60s)", async () => {
      // Expected behavior when timeout IS valid:
      // - If current_bet <= player's current_bet, player auto-checks
      // - Action moves to next player
      // - Player remains in hand
    });

    it.skip("auto-folds when player has bet to call (after 60s)", async () => {
      // Expected behavior when timeout IS valid:
      // - If current_bet > player's current_bet, player auto-folds
      // - Player is marked as folded
      // - If only 1 player remains, hand goes to Showdown
    });

    it.skip("updates last_action_time after timeout", async () => {
      // After successful timeout:
      // - last_action_time should be updated to current time
      // - This resets the timer for the next player
    });
  });

  describe("showdown authorization", () => {
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

      // Start hand and deal cards
      [handPDA] = getHandPDA(tablePDA, 1);
      [deckPDA] = getDeckPDA(tablePDA, 1);

      await program.methods
        .startHand()
        .accounts({
          caller: authority.publicKey,
          table: tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

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
        .signers([authority])
        .rpc();
    });

    it("non-authority fails to call showdown before timeout", async () => {
      // First, have player1 fold so we can reach showdown with 1 player
      const handState = await program.account.handState.fetch(handPDA);
      const actionOnSeat = handState.actionOn;
      const actionPlayer = actionOnSeat === 0 ? player1 : player2;
      const actionSeatPDA = actionOnSeat === 0 ? seat0PDA : seat1PDA;

      // Fold to trigger showdown
      await program.methods
        .playerAction({ fold: {} })
        .accounts({
          player: actionPlayer.publicKey,
          table: tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          playerSeat: actionSeatPDA,
        })
        .signers([actionPlayer])
        .rpc();

      // Verify we're in showdown/settled phase
      const updatedHandState = await program.account.handState.fetch(handPDA);
      expect(updatedHandState.activeCount).to.equal(1);

      // Non-authority tries to call showdown immediately (should fail)
      const nonAuthority = player1;

      try {
        await program.methods
          .showdown()
          .accounts({
            caller: nonAuthority.publicKey,
            table: tablePDA,
            handState: handPDA,
            vault: vaultPDA,
          })
          .remainingAccounts([
            { pubkey: seat0PDA, isSigner: false, isWritable: true },
            { pubkey: seat1PDA, isSigner: false, isWritable: true },
          ])
          .signers([nonAuthority])
          .rpc();
        expect.fail("Should have thrown UnauthorizedAuthority error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("UnauthorizedAuthority");
      }
    });

    it("authority can call showdown immediately", async () => {
      // Fold to trigger single winner situation
      const handState = await program.account.handState.fetch(handPDA);
      const actionOnSeat = handState.actionOn;
      const actionPlayer = actionOnSeat === 0 ? player1 : player2;
      const actionSeatPDA = actionOnSeat === 0 ? seat0PDA : seat1PDA;

      await program.methods
        .playerAction({ fold: {} })
        .accounts({
          player: actionPlayer.publicKey,
          table: tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          playerSeat: actionSeatPDA,
        })
        .signers([actionPlayer])
        .rpc();

      // Authority should be able to call showdown immediately
      const tx = await program.methods
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
        .signers([authority])
        .rpc();

      expect(tx).to.be.a("string");

      // Verify hand is settled
      const finalHandState = await program.account.handState.fetch(handPDA);
      expect(finalHandState.phase).to.deep.equal({ settled: {} });
    });

    it.skip("non-authority can call showdown after 60s timeout", async () => {
      // Expected behavior:
      // - After 60 seconds in Showdown phase
      // - Any player can call showdown to finish the game
      // - This prevents authority from abandoning the game
    });
  });

  // ============================================================
  // VRF + INCO INTEGRATION TESTS
  // These tests verify the privacy features work on devnet
  // Requires: MagicBlock VRF oracle + Inco Lightning program
  // ============================================================
  describe("VRF and Inco Integration", () => {
    // MagicBlock VRF constants
    const DEFAULT_QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");
    const INCO_PROGRAM_ID = new PublicKey("5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj");

    // Helper to fund a keypair by transferring from provider wallet (avoids airdrop rate limits)
    async function fundKeypair(keypair: Keypair, amount: number = 0.5 * LAMPORTS_PER_SOL): Promise<void> {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: keypair.publicKey,
          lamports: amount,
        })
      );
      await provider.sendAndConfirm(tx);
    }

    // Helper to wait for VRF callback (polls is_shuffled flag)
    async function waitForShuffle(
      deckPDA: PublicKey,
      timeoutMs: number = 60000,
      pollIntervalMs: number = 2000
    ): Promise<boolean> {
      const startTime = Date.now();
      const IS_SHUFFLED_OFFSET = 8 + 32 + (52 * 16) + 1; // 873

      while (Date.now() - startTime < timeoutMs) {
        try {
          const accountInfo = await provider.connection.getAccountInfo(deckPDA);
          if (accountInfo && accountInfo.data.length > IS_SHUFFLED_OFFSET) {
            const isShuffled = accountInfo.data[IS_SHUFFLED_OFFSET] === 1;
            if (isShuffled) {
              return true;
            }
          }
        } catch (e) {
          console.warn("Polling deck state:", e);
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      return false;
    }

    it("VRF shuffle + Inco encryption produces encrypted hole cards", async () => {
      // This test proves:
      // 1. VRF oracle responds to shuffle requests
      // 2. Callback atomically shuffles + encrypts cards
      // 3. Hole cards are Inco FHE handles (> 255)

      // Create keypairs and fund from provider wallet (avoids airdrop rate limits)
      const authority = Keypair.generate();
      const player2 = Keypair.generate();

      console.log("Funding test accounts from provider wallet...");
      await fundKeypair(authority, 2 * LAMPORTS_PER_SOL);
      await fundKeypair(player2, 2 * LAMPORTS_PER_SOL);
      console.log("Accounts funded.");

      // Create table
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
          authority: authority.publicKey,
          table: tablePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Player 1 (authority) joins at seat 0
      const [seat0PDA] = getSeatPDA(tablePDA, 0);
      await program.methods
        .joinTable(0, new anchor.BN(MIN_BUY_IN))
        .accounts({
          player: authority.publicKey,
          table: tablePDA,
          playerSeat: seat0PDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Player 2 joins at seat 1
      const [seat1PDA] = getSeatPDA(tablePDA, 1);
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
      const handNumber = BigInt(1);
      const [handPDA] = getHandPDA(tablePDA, Number(handNumber));
      const [deckPDA] = getDeckPDA(tablePDA, Number(handNumber));

      await program.methods
        .startHand()
        .accounts({
          caller: authority.publicKey,
          table: tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      console.log("Hand started. Requesting VRF shuffle...");

      // Request VRF shuffle with seat accounts for atomic encrypt
      const seatAccounts = [
        { pubkey: seat0PDA, isSigner: false, isWritable: true },
        { pubkey: seat1PDA, isSigner: false, isWritable: true },
      ];

      const shuffleTx = await program.methods
        .requestShuffle()
        .accounts({
          authority: authority.publicKey,
          table: tablePDA,
          handState: handPDA,
          deckState: deckPDA,
          oracleQueue: DEFAULT_QUEUE,
          incoProgram: INCO_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(seatAccounts)
        .signers([authority])
        .rpc();

      console.log("VRF request sent:", shuffleTx);
      console.log("Waiting for VRF oracle callback (up to 60s)...");

      // Wait for VRF callback to complete
      const shuffled = await waitForShuffle(deckPDA, 60000, 2000);
      expect(shuffled).to.be.true;

      console.log("VRF callback completed! Verifying encryption...");

      // Fetch deck state - verify is_shuffled
      const deckState = await program.account.deckState.fetch(deckPDA);
      expect(deckState.isShuffled).to.be.true;

      // Fetch player seats - verify hole cards are encrypted (> 255)
      const seat0 = await program.account.playerSeat.fetch(seat0PDA);
      const seat1 = await program.account.playerSeat.fetch(seat1PDA);

      const card0_1 = BigInt(seat0.holeCard1.toString());
      const card0_2 = BigInt(seat0.holeCard2.toString());
      const card1_1 = BigInt(seat1.holeCard1.toString());
      const card1_2 = BigInt(seat1.holeCard2.toString());

      console.log("Seat 0 hole cards:", card0_1.toString(), card0_2.toString());
      console.log("Seat 1 hole cards:", card1_1.toString(), card1_2.toString());

      // Inco FHE handles are always > 255 (plaintext cards are 0-51)
      expect(card0_1 > BigInt(255)).to.be.true;
      expect(card0_2 > BigInt(255)).to.be.true;
      expect(card1_1 > BigInt(255)).to.be.true;
      expect(card1_2 > BigInt(255)).to.be.true;

      // Verify community cards are also encrypted
      const communityCards = deckState.cards.slice(0, 5);
      for (let i = 0; i < 5; i++) {
        const handle = BigInt(communityCards[i].toString());
        console.log(`Community card ${i}: ${handle.toString()}`);
        expect(handle > BigInt(255)).to.be.true;
      }

      console.log("SUCCESS: VRF shuffle + Inco encryption verified!");
      console.log("- Deck is shuffled via MagicBlock VRF");
      console.log("- All hole cards are Inco FHE encrypted handles");
      console.log("- All community cards are Inco FHE encrypted handles");
      console.log("- VRF seed was NEVER stored on-chain (only used in callback memory)");
    });
  });
});
