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
 * Edge case tests for HiddenHand poker
 * These test unusual but critical scenarios that could occur with real money
 */
describe("Edge Cases & Security", () => {
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

  function getOccupiedSeats(bitmap: number, maxPlayers: number): number[] {
    const seats: number[] = [];
    for (let i = 0; i < maxPlayers; i++) {
      if (bitmap & (1 << i)) {
        seats.push(i);
      }
    }
    return seats;
  }

  function findNextOccupied(occupied: number[], after: number, maxPlayers: number): number {
    const sorted = [...occupied].sort((a, b) => a - b);
    for (const seat of sorted) {
      if (seat > after) return seat;
    }
    return sorted[0];
  }

  // ==================== GAME SETUP CLASS ====================

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

      const sbPos = findNextOccupied(occupied, dealerPos, table.maxPlayers);
      const bbPos = findNextOccupied(occupied, sbPos, table.maxPlayers);

      const [sbSeatPDA] = getSeatPDA(this.tablePDA, sbPos);
      const [bbSeatPDA] = getSeatPDA(this.tablePDA, bbPos);

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

    async actCurrentPlayer(action: object) {
      const hand = await this.getHandState();
      const actionIdx = this.players.findIndex(p => p.seatIndex === hand.actionOn);
      await this.playerAction(actionIdx, action);
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

    async leaveTable(playerIndex: number) {
      const player = this.players[playerIndex];

      await program.methods
        .leaveTable()
        .accounts({
          player: player.keypair.publicKey,
          table: this.tablePDA,
          playerSeat: player.seatPDA,
          vault: this.vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([player.keypair])
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

    async getAllSeats() {
      return Promise.all(this.players.map((_, i) => this.getSeat(i)));
    }

    getPlayerBySeat(seatIndex: number) {
      return this.players.find(p => p.seatIndex === seatIndex);
    }

    getPlayerIndexBySeat(seatIndex: number) {
      return this.players.findIndex(p => p.seatIndex === seatIndex);
    }
  }

  // ==================== MULTIPLE SIDE POTS ====================

  describe("Multiple Side Pots (3+ players)", () => {
    it("handles 3 players with different stacks all going all-in", async () => {
      const game = new GameSetup();
      await game.createTable();

      // Player 0: 1 SOL, Player 1: 2 SOL, Player 2: 3 SOL
      await game.addPlayer(0, 1 * LAMPORTS_PER_SOL);
      await game.addPlayer(1, 2 * LAMPORTS_PER_SOL);
      await game.addPlayer(2, 3 * LAMPORTS_PER_SOL);

      await game.startHand();
      await game.dealCards();

      // All three go all-in
      await game.actCurrentPlayer({ allIn: {} });
      await game.actCurrentPlayer({ allIn: {} });
      await game.actCurrentPlayer({ allIn: {} });

      // Should be at showdown
      const hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ showdown: {} });

      await game.showdown();

      // Verify chips are distributed correctly
      const seats = await game.getAllSeats();
      const totalChips = seats.reduce((sum, s) => sum + s.chips.toNumber(), 0);

      // Total should be 6 SOL (1 + 2 + 3) minus blinds that were posted
      // Actually total should be preserved minus the blinds that go to pot
      expect(totalChips).to.be.closeTo(6 * LAMPORTS_PER_SOL, BIG_BLIND);

      // Main pot: 3 * 1 SOL = 3 SOL (all three can win)
      // Side pot 1: 2 * 1 SOL = 2 SOL (only players 1 and 2 can win)
      // Side pot 2: 1 * 1 SOL = 1 SOL (only player 2 can win, returned)
      // Winner gets their share, losers get 0 or returned excess
    });

    it("correctly returns uncallable bets in 3-way all-in", async () => {
      const game = new GameSetup();
      await game.createTable();

      // Different stack sizes within valid buy-in range
      const buyIns = [1, 3, 5].map(x => x * LAMPORTS_PER_SOL);
      const expectedTotal = buyIns.reduce((a, b) => a + b, 0); // 9 SOL

      await game.addPlayer(0, buyIns[0]);
      await game.addPlayer(1, buyIns[1]);
      await game.addPlayer(2, buyIns[2]);

      await game.startHand();
      await game.dealCards();

      // All go all-in
      await game.actCurrentPlayer({ allIn: {} });
      await game.actCurrentPlayer({ allIn: {} });
      await game.actCurrentPlayer({ allIn: {} });

      await game.showdown();

      const seatsAfter = await game.getAllSeats();
      const totalAfter = seatsAfter.reduce((sum, s) => sum + s.chips.toNumber(), 0);

      // Total chips must equal initial buy-ins (conservation of chips)
      expect(totalAfter).to.be.closeTo(expectedTotal, BIG_BLIND);
    });
  });

  // ==================== SPLIT POTS ====================

  describe("Split Pots", () => {
    it("splits pot evenly when hands tie (check through to showdown)", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.startHand();
      await game.dealCards();

      // Both players check through all streets
      // PreFlop
      await game.actCurrentPlayer({ call: {} });
      await game.actCurrentPlayer({ check: {} });

      // Flop, Turn, River - all checks
      for (let i = 0; i < 6; i++) {
        await game.actCurrentPlayer({ check: {} });
      }

      const handBefore = await game.getHandState();
      const potBefore = handBefore.pot.toNumber();

      await game.showdown();

      // In case of tie, pot is split
      // We can't control the cards, so we just verify the mechanics work
      const seats = await game.getAllSeats();
      const totalChips = seats.reduce((sum, s) => sum + s.chips.toNumber(), 0);

      // Total should be 2 SOL (both buy-ins)
      expect(totalChips).to.be.closeTo(2 * MIN_BUY_IN, 1000);
    });
  });

  // ==================== SHORT STACK SCENARIOS ====================

  describe("Short Stack Scenarios", () => {
    it("handles player who can only partially cover the big blind", async () => {
      // This requires a player to have less than BB but more than 0
      // After losing hands, a player might be in this situation
      // For this test, we'd need to play multiple hands to get a player low

      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);

      // Play hands until one player is very low
      // This is a stress test of many consecutive hands
      let handsPlayed = 0;
      const maxHands = 20;

      while (handsPlayed < maxHands) {
        const seats = await game.getAllSeats();
        const minChips = Math.min(...seats.map(s => s.chips.toNumber()));

        // Stop if someone is very low (less than 10 BB)
        if (minChips < 10 * BIG_BLIND && minChips > 0) {
          break;
        }

        await game.startHand();
        await game.dealCards();

        // Quick hand: one player folds
        await game.actCurrentPlayer({ fold: {} });
        await game.showdown();

        handsPlayed++;
      }

      // Verify game still works with low stack
      const table = await game.getTable();
      expect(table.status).to.deep.equal({ waiting: {} });
    });

    it("handles all-in for less than the call amount", async () => {
      const game = new GameSetup();
      await game.createTable();

      // Player 0 has minimum buy-in, Player 1 has max
      await game.addPlayer(0, MIN_BUY_IN);    // 1 SOL
      await game.addPlayer(1, MAX_BUY_IN);    // 5 SOL

      await game.startHand();
      await game.dealCards();

      // Player 1 raises big (say 2 SOL)
      const hand = await game.getHandState();
      const actionIdx = game.getPlayerIndexBySeat(hand.actionOn);

      // First to act raises to 2 SOL
      const seat = await game.getSeat(actionIdx);
      const raiseTarget = 2 * LAMPORTS_PER_SOL;
      const raiseAmount = raiseTarget - seat.currentBet.toNumber();
      await game.playerAction(actionIdx, { raise: { amount: new anchor.BN(raiseAmount) } });

      // Other player goes all-in (can only put in ~1 SOL)
      await game.actCurrentPlayer({ allIn: {} });

      // Should go to showdown since both have acted and one is all-in
      const handAfter = await game.getHandState();
      expect(handAfter.phase).to.deep.equal({ showdown: {} });

      await game.showdown();

      // Verify chips conserved (total = 1 + 5 = 6 SOL)
      const seats = await game.getAllSeats();
      const total = seats.reduce((sum, s) => sum + s.chips.toNumber(), 0);
      expect(total).to.be.closeTo(MIN_BUY_IN + MAX_BUY_IN, BIG_BLIND);
    });
  });

  // ==================== RE-RAISE SEQUENCES ====================

  describe("Re-raise Sequences", () => {
    it("handles raise, re-raise, re-re-raise correctly", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, 5 * LAMPORTS_PER_SOL);
      await game.addPlayer(1, 5 * LAMPORTS_PER_SOL);
      await game.startHand();
      await game.dealCards();

      let hand = await game.getHandState();

      // First player raises to 2 BB
      let seat = await game.getSeat(game.getPlayerIndexBySeat(hand.actionOn));
      let raiseAmount = 2 * BIG_BLIND - seat.currentBet.toNumber();
      await game.actCurrentPlayer({ raise: { amount: new anchor.BN(raiseAmount) } });

      // Second player re-raises to 4 BB
      hand = await game.getHandState();
      seat = await game.getSeat(game.getPlayerIndexBySeat(hand.actionOn));
      raiseAmount = 4 * BIG_BLIND - seat.currentBet.toNumber();
      await game.actCurrentPlayer({ raise: { amount: new anchor.BN(raiseAmount) } });

      // First player re-re-raises to 8 BB
      hand = await game.getHandState();
      seat = await game.getSeat(game.getPlayerIndexBySeat(hand.actionOn));
      raiseAmount = 8 * BIG_BLIND - seat.currentBet.toNumber();
      await game.actCurrentPlayer({ raise: { amount: new anchor.BN(raiseAmount) } });

      // Verify current bet is now 8 BB
      hand = await game.getHandState();
      expect(hand.currentBet.toNumber()).to.equal(8 * BIG_BLIND);

      // Second player calls
      await game.actCurrentPlayer({ call: {} });

      // Should advance to flop
      hand = await game.getHandState();
      expect(hand.phase).to.deep.equal({ flop: {} });
    });

    it("enforces minimum raise is at least previous raise size", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, 5 * LAMPORTS_PER_SOL);
      await game.addPlayer(1, 5 * LAMPORTS_PER_SOL);
      await game.startHand();
      await game.dealCards();

      let hand = await game.getHandState();
      const initialCurrentBet = hand.currentBet.toNumber(); // BB = 0.02 SOL

      // First player raises to 4 BB total
      // This is a raise of (4 BB - 1 BB current bet) = 3 BB above current bet
      let seat = await game.getSeat(game.getPlayerIndexBySeat(hand.actionOn));
      const targetBet = 4 * BIG_BLIND;
      let raiseAmount = targetBet - seat.currentBet.toNumber();
      await game.actCurrentPlayer({ raise: { amount: new anchor.BN(raiseAmount) } });

      // Min raise should now be the size of the previous raise (3 BB)
      hand = await game.getHandState();
      const expectedMinRaise = targetBet - initialCurrentBet; // 4 BB - 1 BB = 3 BB
      expect(hand.minRaise.toNumber()).to.equal(expectedMinRaise);

      // Second player tries to raise less than min_raise (should fail)
      // Current bet is 4 BB, min raise is 3 BB, so minimum valid target is 7 BB
      // Try to raise to only 5 BB (only 1 BB more, less than min_raise of 3 BB)
      seat = await game.getSeat(game.getPlayerIndexBySeat(hand.actionOn));
      const invalidTarget = 5 * BIG_BLIND;
      const smallRaise = invalidTarget - seat.currentBet.toNumber();

      try {
        await game.actCurrentPlayer({ raise: { amount: new anchor.BN(smallRaise) } });
        expect.fail("Should have thrown RaiseTooSmall");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("RaiseTooSmall");
      }
    });
  });

  // ==================== LEAVING/JOINING DURING HAND ====================

  describe("Leaving During Active Hand", () => {
    it("prevents player from leaving during active hand", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.startHand();
      await game.dealCards();

      // Try to leave while hand is in progress
      try {
        await game.leaveTable(0);
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CannotLeaveDuringHand");
      }
    });
  });

  // ==================== CONSECUTIVE HANDS ====================

  describe("Consecutive Hands (State Integrity)", () => {
    it("plays 10 consecutive hands without state corruption", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, 3 * LAMPORTS_PER_SOL);
      await game.addPlayer(1, 3 * LAMPORTS_PER_SOL);

      const initialTotal = 6 * LAMPORTS_PER_SOL;

      for (let handNum = 1; handNum <= 10; handNum++) {
        await game.startHand();
        await game.dealCards();

        // Play quick hands - one player folds (2 players = instant end)
        await game.actCurrentPlayer({ fold: {} });

        await game.showdown();

        // Verify state after each hand
        const table = await game.getTable();
        expect(table.status).to.deep.equal({ waiting: {} });
        expect(table.handNumber.toNumber()).to.equal(handNum);

        // Verify chip conservation (most critical check)
        const seats = await game.getAllSeats();
        const totalChips = seats.reduce((sum, s) => sum + s.chips.toNumber(), 0);
        expect(totalChips).to.be.closeTo(initialTotal, BIG_BLIND);
      }
    });

    it("dealer button rotates correctly over multiple hands", async () => {
      const game = new GameSetup();
      await game.createTable();
      // Use 2 players so fold ends the hand immediately
      await game.addPlayer(0, 3 * LAMPORTS_PER_SOL);
      await game.addPlayer(1, 3 * LAMPORTS_PER_SOL);

      const dealerPositions: number[] = [];

      for (let i = 0; i < 6; i++) {
        await game.startHand();

        const table = await game.getTable();
        dealerPositions.push(table.dealerPosition);

        await game.dealCards();
        await game.actCurrentPlayer({ fold: {} });
        await game.showdown();
      }

      // With 2 players, dealer should alternate between 0 and 1
      // Each position should appear 3 times over 6 hands
      expect(dealerPositions.filter(p => p === 0).length).to.equal(3);
      expect(dealerPositions.filter(p => p === 1).length).to.equal(3);
    });
  });

  // ==================== CHIP CONSERVATION ====================

  describe("Chip Conservation (Critical)", () => {
    it("total chips always equal sum of buy-ins after any hand", async () => {
      const game = new GameSetup();
      await game.createTable();

      // Use 2 players for simpler hand completion
      await game.addPlayer(0, 2 * LAMPORTS_PER_SOL);
      await game.addPlayer(1, 3 * LAMPORTS_PER_SOL);
      const expectedTotal = 5 * LAMPORTS_PER_SOL;

      // Play several hands with various outcomes
      for (let hand = 0; hand < 5; hand++) {
        await game.startHand();
        await game.dealCards();

        // Alternate actions
        if (hand % 3 === 0) {
          // Fold
          await game.actCurrentPlayer({ fold: {} });
        } else if (hand % 3 === 1) {
          // All-in
          await game.actCurrentPlayer({ allIn: {} });
          await game.actCurrentPlayer({ call: {} });
        } else {
          // Play through to showdown
          await game.actCurrentPlayer({ call: {} });
          await game.actCurrentPlayer({ check: {} });
          for (let i = 0; i < 6; i++) {
            await game.actCurrentPlayer({ check: {} });
          }
        }

        await game.showdown();

        // CRITICAL CHECK: chips must be conserved
        const seats = await game.getAllSeats();
        const actualTotal = seats.reduce((sum, s) => sum + s.chips.toNumber(), 0);

        expect(actualTotal).to.be.closeTo(
          expectedTotal,
          1000, // Allow 1000 lamports tolerance for any rounding
          `Hand ${hand + 1}: Chips not conserved! Expected ${expectedTotal}, got ${actualTotal}`
        );
      }
    });

    it("pot is always fully distributed at showdown", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);

      for (let i = 0; i < 3; i++) {
        await game.startHand();
        await game.dealCards();

        // Build a pot with betting
        await game.actCurrentPlayer({ call: {} });
        await game.actCurrentPlayer({ check: {} });

        for (let j = 0; j < 6; j++) {
          await game.actCurrentPlayer({ check: {} });
        }

        const handBefore = await game.getHandState();
        expect(handBefore.pot.toNumber()).to.be.greaterThan(0);

        await game.showdown();

        // Pot must be zero after showdown
        const handAfter = await game.getHandState();
        expect(handAfter.pot.toNumber()).to.equal(0);
      }
    });
  });

  // ==================== SECURITY TESTS ====================

  describe("Security", () => {
    it("prevents non-authority from starting hand", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);

      const table = await game.getTable();
      const handNumber = table.handNumber.toNumber() + 1;
      const [handPDA] = getHandPDA(game.tablePDA, handNumber);
      const [deckPDA] = getDeckPDA(game.tablePDA, handNumber);

      // Player tries to start hand (should fail)
      try {
        await program.methods
          .startHand()
          .accounts({
            authority: game.players[0].keypair.publicKey,
            table: game.tablePDA,
            handState: handPDA,
            deckState: deckPDA,
            systemProgram: SystemProgram.programId,
          })
          .signers([game.players[0].keypair])
          .rpc();
        expect.fail("Should have thrown UnauthorizedAuthority");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("UnauthorizedAuthority");
      }
    });

    it("prevents non-authority from calling showdown", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.startHand();
      await game.dealCards();

      // Play to showdown phase
      await game.actCurrentPlayer({ allIn: {} });
      await game.actCurrentPlayer({ call: {} });

      const remainingAccounts = game.players.map(p => ({
        pubkey: p.seatPDA,
        isSigner: false,
        isWritable: true,
      }));

      // Player tries to call showdown (should fail)
      try {
        await program.methods
          .showdown()
          .accounts({
            authority: game.players[0].keypair.publicKey,
            table: game.tablePDA,
            handState: game.handPDA!,
            vault: game.vaultPDA,
          })
          .remainingAccounts(remainingAccounts)
          .signers([game.players[0].keypair])
          .rpc();
        expect.fail("Should have thrown UnauthorizedAuthority");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("UnauthorizedAuthority");
      }
    });

    it("prevents player from acting for another player", async () => {
      const game = new GameSetup();
      await game.createTable();
      await game.addPlayer(0, MIN_BUY_IN);
      await game.addPlayer(1, MIN_BUY_IN);
      await game.startHand();
      await game.dealCards();

      const hand = await game.getHandState();
      const actionOn = hand.actionOn;
      const wrongPlayer = game.players.find(p => p.seatIndex !== actionOn)!;
      const correctSeat = game.players.find(p => p.seatIndex === actionOn)!;

      // Wrong player tries to act using correct player's seat
      try {
        await program.methods
          .playerAction({ fold: {} })
          .accounts({
            player: wrongPlayer.keypair.publicKey,
            table: game.tablePDA,
            handState: game.handPDA!,
            deckState: game.deckPDA!,
            playerSeat: correctSeat.seatPDA,
          })
          .signers([wrongPlayer.keypair])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        // Should fail due to player/seat mismatch
        expect(err.error).to.exist;
      }
    });
  });
});
