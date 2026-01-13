import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Hiddenhand } from "../target/types/hiddenhand";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";

/**
 * Comprehensive game mechanics tests for HiddenHand poker
 * Tests full game flows, edge cases, and multi-player scenarios
 */
describe("Game Mechanics", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Hiddenhand as Program<Hiddenhand>;

  // Test constants
  const SMALL_BLIND = 0.01 * LAMPORTS_PER_SOL;
  const BIG_BLIND = 0.02 * LAMPORTS_PER_SOL;
  const MIN_BUY_IN = 1 * LAMPORTS_PER_SOL;
  const MAX_BUY_IN = 5 * LAMPORTS_PER_SOL;
  const MAX_PLAYERS = 6;

  // ==================== HELPERS ====================

  function generateTableId(): number[] {
    return Array.from(Keypair.generate().publicKey.toBytes());
  }

  function getTablePDA(tableId: number[]): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("table"), Buffer.from(tableId)],
      program.programId
    );
  }

  function getVaultPDA(table: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), table.toBuffer()],
      program.programId
    );
  }

  function getSeatPDA(table: PublicKey, seatIndex: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("seat"), table.toBuffer(), Buffer.from([seatIndex])],
      program.programId
    );
  }

  function getHandPDA(table: PublicKey, handNumber: number): [PublicKey, number] {
    const handNumberBuffer = Buffer.alloc(8);
    handNumberBuffer.writeBigUInt64LE(BigInt(handNumber));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("hand"), table.toBuffer(), handNumberBuffer],
      program.programId
    );
  }

  function getDeckPDA(table: PublicKey, handNumber: number): [PublicKey, number] {
    const handNumberBuffer = Buffer.alloc(8);
    handNumberBuffer.writeBigUInt64LE(BigInt(handNumber));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("deck"), table.toBuffer(), handNumberBuffer],
      program.programId
    );
  }

  async function airdrop(address: PublicKey, amount: number = 10 * LAMPORTS_PER_SOL) {
    const sig = await provider.connection.requestAirdrop(address, amount);
    await provider.connection.confirmTransaction(sig);
  }

  async function createFundedKeypair(): Promise<Keypair> {
    const keypair = Keypair.generate();
    await airdrop(keypair.publicKey);
    return keypair;
  }

  // Helper to get occupied seat indices from bitmap
  function getOccupiedSeats(bitmap: number, maxPlayers: number): number[] {
    const seats: number[] = [];
    for (let i = 0; i < maxPlayers; i++) {
      if (bitmap & (1 << i)) {
        seats.push(i);
      }
    }
    return seats;
  }

  // Helper to find next occupied seat after given position
  function findNextOccupied(occupied: number[], after: number, maxPlayers: number): number {
    const sorted = [...occupied].sort((a, b) => a - b);
    for (const seat of sorted) {
      if (seat > after) return seat;
    }
    return sorted[0]; // Wrap around
  }

  // ==================== TEST SETUP CLASS ====================

  class GameSetup {
    tableId: number[];
    tablePDA: PublicKey;
    vaultPDA: PublicKey;
    authority: Keypair;
    players: { keypair: Keypair; seatIndex: number; seatPDA: PublicKey; buyIn: number }[] = [];
    handPDA: PublicKey | null = null;
    deckPDA: PublicKey | null = null;
    handNumber: number = 0;

    constructor() {
      this.tableId = generateTableId();
      [this.tablePDA] = getTablePDA(this.tableId);
      [this.vaultPDA] = getVaultPDA(this.tablePDA);
    }

    async createTable(authority?: Keypair) {
      this.authority = authority || await createFundedKeypair();

      await program.methods
        .createTable(
          this.tableId,
          new anchor.BN(SMALL_BLIND),
          new anchor.BN(BIG_BLIND),
          new anchor.BN(MIN_BUY_IN),
          new anchor.BN(MAX_BUY_IN),
          MAX_PLAYERS
        )
        .accounts({
          authority: this.authority.publicKey,
          table: this.tablePDA,
          vault: this.vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.authority])
        .rpc();

      return this;
    }

    async addPlayer(seatIndex: number, buyIn: number = MIN_BUY_IN) {
      const keypair = await createFundedKeypair();
      const [seatPDA] = getSeatPDA(this.tablePDA, seatIndex);

      await program.methods
        .joinTable(seatIndex, new anchor.BN(buyIn))
        .accounts({
          player: keypair.publicKey,
          table: this.tablePDA,
          playerSeat: seatPDA,
          vault: this.vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

      this.players.push({ keypair, seatIndex, seatPDA, buyIn });
      return this;
    }

    async startHand() {
      const table = await program.account.table.fetch(this.tablePDA);
      this.handNumber = table.handNumber.toNumber() + 1;
      [this.handPDA] = getHandPDA(this.tablePDA, this.handNumber);
      [this.deckPDA] = getDeckPDA(this.tablePDA, this.handNumber);

      await program.methods
        .startHand()
        .accounts({
          authority: this.authority.publicKey,
          table: this.tablePDA,
          handState: this.handPDA,
          deckState: this.deckPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.authority])
        .rpc();

      return this;
    }

    async dealCards() {
      const table = await program.account.table.fetch(this.tablePDA);
      const occupied = getOccupiedSeats(table.occupiedSeats, table.maxPlayers);
      const dealerPos = table.dealerPosition;

      // Calculate SB and BB positions
      const sbPos = findNextOccupied(occupied, dealerPos, table.maxPlayers);
      const bbPos = findNextOccupied(occupied, sbPos, table.maxPlayers);

      const [sbSeatPDA] = getSeatPDA(this.tablePDA, sbPos);
      const [bbSeatPDA] = getSeatPDA(this.tablePDA, bbPos);

      // Get other player seats for remaining_accounts
      const otherSeats = this.players
        .filter(p => p.seatIndex !== sbPos && p.seatIndex !== bbPos)
        .map(p => ({ pubkey: p.seatPDA, isSigner: false, isWritable: true }));

      await program.methods
        .dealCards()
        .accounts({
          authority: this.authority.publicKey,
          table: this.tablePDA,
          handState: this.handPDA!,
          deckState: this.deckPDA!,
          sbSeat: sbSeatPDA,
          bbSeat: bbSeatPDA,
        })
        .remainingAccounts(otherSeats)
        .signers([this.authority])
        .rpc();

      return this;
    }

    async playerAction(playerIndex: number, action: object) {
      const player = this.players[playerIndex];

      await program.methods
        .playerAction(action)
        .accounts({
          player: player.keypair.publicKey,
          table: this.tablePDA,
          handState: this.handPDA!,
          deckState: this.deckPDA!,
          playerSeat: player.seatPDA,
        })
        .signers([player.keypair])
        .rpc();

      return this;
    }

    async showdown() {
      const remainingAccounts = this.players.map(p => ({
        pubkey: p.seatPDA,
        isSigner: false,
        isWritable: true,
      }));

      await program.methods
        .showdown()
        .accounts({
          authority: this.authority.publicKey,
          table: this.tablePDA,
          handState: this.handPDA!,
          vault: this.vaultPDA,
        })
        .remainingAccounts(remainingAccounts)
        .signers([this.authority])
        .rpc();

      return this;
    }

    async getTable() {
      return program.account.table.fetch(this.tablePDA);
    }

    async getHandState() {
      return program.account.handState.fetch(this.handPDA!);
    }

    async getSeat(playerIndex: number) {
      return program.account.playerSeat.fetch(this.players[playerIndex].seatPDA);
    }

    getPlayerBySeat(seatIndex: number) {
      return this.players.find(p => p.seatIndex === seatIndex);
    }
  }

  // ==================== TESTS ====================

  describe("2-Player Game (Heads-Up)", () => {
    it("completes a full hand where one player folds", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.startHand();
      await game.dealCards();

      const handBefore = await game.getHandState();
      expect(handBefore.phase).to.deep.equal({ preFlop: {} });
      expect(handBefore.pot.toNumber()).to.equal(SMALL_BLIND + BIG_BLIND);

      // Find who is to act (should be after BB)
      const actionOn = handBefore.actionOn;
      const actionPlayer = game.getPlayerBySeat(actionOn);
      const actionPlayerIndex = game.players.findIndex(p => p.seatIndex === actionOn);

      // Player folds
      await game.playerAction(actionPlayerIndex, { fold: {} });

      const handAfter = await game.getHandState();
      // Hand should go to showdown/settled when only 1 player remains
      expect(handAfter.activeCount).to.equal(1);
    });

    it("completes a full hand with betting to showdown", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.startHand();
      await game.dealCards();

      // Helper to get current action player and act
      const actWithCurrentPlayer = async (action: object) => {
        const hand = await game.getHandState();
        const actionIdx = game.players.findIndex(p => p.seatIndex === hand.actionOn);
        await game.playerAction(actionIdx, action);
      };

      // PreFlop: first to act calls, BB checks
      await actWithCurrentPlayer({ call: {} });
      await actWithCurrentPlayer({ check: {} });

      // Flop
      let hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ flop: {} });

      // Both check through flop
      await actWithCurrentPlayer({ check: {} });
      await actWithCurrentPlayer({ check: {} });

      // Turn
      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ turn: {} });

      // Both check through turn
      await actWithCurrentPlayer({ check: {} });
      await actWithCurrentPlayer({ check: {} });

      // River
      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ river: {} });

      // Both check through river
      await actWithCurrentPlayer({ check: {} });
      await actWithCurrentPlayer({ check: {} });

      // Should be at showdown
      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ showdown: {} });

      // Run showdown
      await game.showdown();

      // Verify hand is settled
      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ settled: {} });
      expect(hand.pot.toNumber()).to.equal(0); // Pot distributed

      // Table should be back to waiting
      const table = await game.getTable();
      expect(table.status).to.deep.equal({ waiting: {} });
    });

    it("handles all-in correctly", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN); // 1 SOL
      await game.addPlayer(1, MIN_BUY_IN); // 1 SOL
      await game.startHand();
      await game.dealCards();

      const handState = await game.getHandState();
      const actionOn = handState.actionOn;
      const actionPlayerIdx = game.players.findIndex(p => p.seatIndex === actionOn);
      const otherIdx = actionPlayerIdx === 0 ? 1 : 0;

      // First player goes all-in
      await game.playerAction(actionPlayerIdx, { allIn: {} });

      // Other player calls (also goes all-in with same stack)
      await game.playerAction(otherIdx, { call: {} });

      // Should auto-advance to showdown since both all-in
      const hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ showdown: {} });

      // Run showdown
      await game.showdown();

      // One player should have ~2 SOL, other should have ~0
      const seat0 = await game.getSeat(0);
      const seat1 = await game.getSeat(1);
      const totalChips = seat0.chips.toNumber() + seat1.chips.toNumber();

      // Total should be approximately 2 SOL (both buy-ins)
      expect(totalChips).to.be.closeTo(2 * MIN_BUY_IN, SMALL_BLIND);
    });
  });

  describe("3-Player Game", () => {
    it("correctly positions dealer, SB, and BB", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(2, MIN_BUY_IN);
      await game.addPlayer(4, MIN_BUY_IN);
      await game.startHand();

      const table = await game.getTable();
      const dealerPos = table.dealerPosition;

      // Dealer should be at an occupied seat
      expect([0, 2, 4]).to.include(dealerPos);

      await game.dealCards();

      // Check blinds were posted correctly
      const handState = await game.getHandState();
      expect(handState.pot.toNumber()).to.equal(SMALL_BLIND + BIG_BLIND);
    });

    it("handles one player folding, two going to showdown", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.addPlayer(2, MIN_BUY_IN);
      await game.startHand();
      await game.dealCards();

      let hand = await game.getHandState();
      const table = await game.getTable();
      const occupied = getOccupiedSeats(table.occupiedSeats, table.maxPlayers);
      const dealerPos = table.dealerPosition;
      const sbPos = findNextOccupied(occupied, dealerPos, table.maxPlayers);
      const bbPos = findNextOccupied(occupied, sbPos, table.maxPlayers);

      // First to act is after BB (UTG in 3-handed = dealer)
      let actionOn = hand.actionOn;

      // UTG folds
      let actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);
      await game.playerAction(actionIdx, { fold: {} });

      // SB calls
      hand = await game.getHandState();
      actionOn = hand.actionOn;
      actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);
      await game.playerAction(actionIdx, { call: {} });

      // BB checks
      hand = await game.getHandState();
      actionOn = hand.actionOn;
      actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);
      await game.playerAction(actionIdx, { check: {} });

      // Continue checking through all streets
      for (let street = 0; street < 3; street++) {
        hand = await game.getHandState();
        for (let i = 0; i < 2; i++) {
          hand = await game.getHandState();
          actionOn = hand.actionOn;
          actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);
          await game.playerAction(actionIdx, { check: {} });
        }
      }

      // Should be at showdown
      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ showdown: {} });
      expect(hand.activeCount).to.equal(2); // 2 players remaining

      await game.showdown();

      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ settled: {} });
    });
  });

  describe("Side Pot Scenarios", () => {
    it("returns excess chips when player bets more than others can call", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, 2 * LAMPORTS_PER_SOL); // 2 SOL
      await game.addPlayer(1, 1 * LAMPORTS_PER_SOL); // 1 SOL
      await game.startHand();
      await game.dealCards();

      const seat0Before = await game.getSeat(0);
      const seat1Before = await game.getSeat(1);

      const hand = await game.getHandState();
      const actionOn = hand.actionOn;
      const actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);
      const otherIdx = actionIdx === 0 ? 1 : 0;

      // First player goes all-in (2 SOL)
      await game.playerAction(actionIdx, { allIn: {} });

      // Second player calls all-in (1 SOL)
      await game.playerAction(otherIdx, { allIn: {} });

      // Run showdown
      await game.showdown();

      const seat0After = await game.getSeat(0);
      const seat1After = await game.getSeat(1);

      // Total chips should be preserved (3 SOL total minus blinds already posted)
      const totalBefore = seat0Before.chips.toNumber() + seat1Before.chips.toNumber();
      const totalAfter = seat0After.chips.toNumber() + seat1After.chips.toNumber();

      // Winner should have at most 2 SOL (1 SOL from each player)
      // The excess 1 SOL should be returned to the bigger stack
      const maxWinnings = 2 * 1 * LAMPORTS_PER_SOL; // 2 SOL max pot

      const winner = seat0After.chips.toNumber() > seat1After.chips.toNumber() ? seat0After : seat1After;
      const loser = seat0After.chips.toNumber() > seat1After.chips.toNumber() ? seat1After : seat0After;

      // Winner should have ~2 SOL (winning the pot of 2 SOL)
      // If winner was the 2 SOL player, they get back 1 SOL excess + win 1 SOL = 2 SOL
      // If winner was the 1 SOL player, they win 2 SOL
      expect(winner.chips.toNumber()).to.be.closeTo(2 * LAMPORTS_PER_SOL, BIG_BLIND);

      // Loser should have either 0 or 1 SOL (if they were the bigger stack and lost)
      expect(loser.chips.toNumber()).to.be.lessThanOrEqual(1 * LAMPORTS_PER_SOL);
    });
  });

  describe("Dealer Button Advancement", () => {
    it("advances dealer button between hands", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);

      // Hand 1
      await game.startHand();
      const table1 = await game.getTable();
      const dealer1 = table1.dealerPosition;

      await game.dealCards();

      // Quick fold to end hand
      let hand = await game.getHandState();
      const actionIdx = game.players.findIndex(p => p.seatIndex === hand.actionOn);
      await game.playerAction(actionIdx, { fold: {} });
      await game.showdown();

      // Hand 2
      await game.startHand();
      const table2 = await game.getTable();
      const dealer2 = table2.dealerPosition;

      // Dealer should have advanced
      expect(dealer2).to.not.equal(dealer1);
      expect([0, 1]).to.include(dealer2);
    });

    it("skips empty seats when advancing dealer", async () => {
      const game = new GameSetup();
      await game.createTable();
      // Players at seats 0 and 3 (leaving 1, 2 empty)
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(3, MIN_BUY_IN);

      await game.startHand();
      const table1 = await game.getTable();
      const dealer1 = table1.dealerPosition;

      // Dealer should be at 0 or 3
      expect([0, 3]).to.include(dealer1);

      await game.dealCards();

      // End hand quickly
      let hand = await game.getHandState();
      const actionIdx = game.players.findIndex(p => p.seatIndex === hand.actionOn);
      await game.playerAction(actionIdx, { fold: {} });
      await game.showdown();

      // Hand 2
      await game.startHand();
      const table2 = await game.getTable();
      const dealer2 = table2.dealerPosition;

      // Dealer should have moved to the other occupied seat
      expect([0, 3]).to.include(dealer2);
      expect(dealer2).to.not.equal(dealer1);
    });
  });

  describe("Phase Transitions", () => {
    it("transitions through all phases correctly", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.startHand();

      let hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ dealing: {} });

      await game.dealCards();

      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ preFlop: {} });
      expect(hand.communityRevealed).to.equal(0);

      // PreFlop betting
      let actionOn = hand.actionOn;
      let actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);
      let otherIdx = actionIdx === 0 ? 1 : 0;
      await game.playerAction(actionIdx, { call: {} });
      await game.playerAction(otherIdx, { check: {} });

      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ flop: {} });
      expect(hand.communityRevealed).to.equal(3);

      // Flop betting
      actionOn = hand.actionOn;
      actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);
      otherIdx = actionIdx === 0 ? 1 : 0;
      await game.playerAction(actionIdx, { check: {} });
      await game.playerAction(otherIdx, { check: {} });

      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ turn: {} });
      expect(hand.communityRevealed).to.equal(4);

      // Turn betting
      actionOn = hand.actionOn;
      actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);
      otherIdx = actionIdx === 0 ? 1 : 0;
      await game.playerAction(actionIdx, { check: {} });
      await game.playerAction(otherIdx, { check: {} });

      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ river: {} });
      expect(hand.communityRevealed).to.equal(5);

      // River betting
      actionOn = hand.actionOn;
      actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);
      otherIdx = actionIdx === 0 ? 1 : 0;
      await game.playerAction(actionIdx, { check: {} });
      await game.playerAction(otherIdx, { check: {} });

      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ showdown: {} });
    });
  });

  describe("Betting Mechanics", () => {
    it("enforces minimum raise", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.startHand();
      await game.dealCards();

      const hand = await game.getHandState();
      const actionOn = hand.actionOn;
      const actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);

      // Try to raise less than min raise (should fail)
      try {
        await game.playerAction(actionIdx, { raise: { amount: new anchor.BN(BIG_BLIND / 2) } });
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("RaiseTooSmall");
      }
    });

    it("allows valid raise", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.startHand();
      await game.dealCards();

      const hand = await game.getHandState();
      const actionOn = hand.actionOn;
      const actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);

      const seatBefore = await game.getSeat(actionIdx);
      const alreadyBet = seatBefore.currentBet.toNumber();

      // PreFlop: current_bet = BB, min_raise = BB
      // The raise amount is additional chips on top of what player already bet
      // To make min raise: new_total = BB + min_raise = 2*BB
      // Player needs to add: 2*BB - already_bet
      const targetBet = 2 * BIG_BLIND;
      const raiseAmount = targetBet - alreadyBet;

      await game.playerAction(actionIdx, { raise: { amount: new anchor.BN(raiseAmount) } });

      const handAfter = await game.getHandState();
      const seatAfter = await game.getSeat(actionIdx);

      // Player's current bet should be 2*BB
      expect(seatAfter.currentBet.toNumber()).to.equal(targetBet);
      // Hand's current bet should also be 2*BB
      expect(handAfter.currentBet.toNumber()).to.equal(targetBet);
    });

    it("prevents acting out of turn", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.startHand();
      await game.dealCards();

      const hand = await game.getHandState();
      const actionOn = hand.actionOn;
      const wrongPlayerSeat = actionOn === 0 ? 1 : 0;
      const wrongPlayerIdx = game.players.findIndex(p => p.seatIndex === wrongPlayerSeat);

      // Try to act when it's not your turn
      try {
        await game.playerAction(wrongPlayerIdx, { check: {} });
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("NotPlayersTurn");
      }
    });
  });

  describe("6-Player Game", () => {
    it("handles full table with all 6 players", async () => {
      const game = new GameSetup();
      await game.createTable();

      // Fill all 6 seats
      for (let i = 0; i < 6; i++) {
        await game.addPlayer(i, MIN_BUY_IN);
      }

      const table = await game.getTable();
      expect(table.currentPlayers).to.equal(6);

      await game.startHand();
      await game.dealCards();

      const hand = await game.getHandState();
      expect(hand.activeCount).to.equal(6);
      expect(hand.pot.toNumber()).to.equal(SMALL_BLIND + BIG_BLIND);

      // All players fold except one
      for (let i = 0; i < 5; i++) {
        const currentHand = await game.getHandState();
        const actionOn = currentHand.actionOn;
        const actionIdx = game.players.findIndex(p => p.seatIndex === actionOn);
        await game.playerAction(actionIdx, { fold: {} });
      }

      // One player remaining - hand should end
      const finalHand = await game.getHandState();
      expect(finalHand.activeCount).to.equal(1);
    });
  });

  describe("Chip Tracking", () => {
    it("correctly tracks total bet per hand", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.startHand();
      await game.dealCards();

      // Find SB and BB
      const table = await game.getTable();
      const occupied = getOccupiedSeats(table.occupiedSeats, table.maxPlayers);
      const dealerPos = table.dealerPosition;
      const sbPos = findNextOccupied(occupied, dealerPos, table.maxPlayers);
      const bbPos = findNextOccupied(occupied, sbPos, table.maxPlayers);

      const sbIdx = game.players.findIndex(p => p.seatIndex === sbPos);
      const bbIdx = game.players.findIndex(p => p.seatIndex === bbPos);

      const sbSeat = await game.getSeat(sbIdx);
      const bbSeat = await game.getSeat(bbIdx);

      // SB should have posted small blind
      expect(sbSeat.totalBetThisHand.toNumber()).to.equal(SMALL_BLIND);

      // BB should have posted big blind
      expect(bbSeat.totalBetThisHand.toNumber()).to.equal(BIG_BLIND);
    });

    it("resets bet tracking between hands", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, 2 * MIN_BUY_IN); // Extra chips for multiple hands
      await game.addPlayer(1, 2 * MIN_BUY_IN);

      // Hand 1
      await game.startHand();
      await game.dealCards();

      let hand = await game.getHandState();
      let actionIdx = game.players.findIndex(p => p.seatIndex === hand.actionOn);
      await game.playerAction(actionIdx, { fold: {} });
      await game.showdown();

      // Hand 2
      await game.startHand();
      await game.dealCards();

      // Check that bets are reset
      const seat0 = await game.getSeat(0);
      const seat1 = await game.getSeat(1);

      // Each seat should only have their blind posted (SB or BB)
      expect(seat0.totalBetThisHand.toNumber()).to.be.oneOf([SMALL_BLIND, BIG_BLIND]);
      expect(seat1.totalBetThisHand.toNumber()).to.be.oneOf([SMALL_BLIND, BIG_BLIND]);
    });
  });
});
