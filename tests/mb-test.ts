import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { MbTest } from "../target/types/mb_test";
import { expect } from "chai";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";

const GAME_SEED = "game";
const PLAYER_SEED = "player";

describe("mb-test", () => {
  // Configure providers
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Ephemeral Rollup provider (use devnet or local)
  const ephemeralRpcUrl = process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app/";
  const ephemeralWsUrl = process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet.magicblock.app/";

  const providerER = new anchor.AnchorProvider(
    new anchor.web3.Connection(ephemeralRpcUrl, {
      wsEndpoint: ephemeralWsUrl,
    }),
    anchor.Wallet.local()
  );

  const program = anchor.workspace.MbTest as Program<MbTest>;

  // Derive PDAs
  const [gamePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from(GAME_SEED)],
    program.programId
  );

  const [playerPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from(PLAYER_SEED), provider.wallet.publicKey.toBuffer()],
    program.programId
  );

  console.log("Program ID:", program.programId.toString());
  console.log("Game PDA:", gamePDA.toString());
  console.log("Player PDA:", playerPDA.toString());
  console.log("Base Layer RPC:", provider.connection.rpcEndpoint);
  console.log("Ephemeral RPC:", ephemeralRpcUrl);

  before(async function () {
    const balance = await provider.connection.getBalance(provider.wallet.publicKey);
    console.log("Wallet balance:", balance / LAMPORTS_PER_SOL, "SOL\n");

    if (balance < LAMPORTS_PER_SOL) {
      console.log("Low balance - requesting airdrop...");
      const sig = await provider.connection.requestAirdrop(
        provider.wallet.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }
  });

  // ============================================================
  // PART 1: Basic Functionality Tests (Base Layer)
  // ============================================================

  describe("Part 1: Basic Functionality (Base Layer)", () => {
    it("initializes a game account", async () => {
      try {
        const tx = await program.methods
          .initializeGame()
          .accounts({
            authority: provider.wallet.publicKey,
            game: gamePDA,
            systemProgram: web3.SystemProgram.programId,
          })
          .rpc();

        console.log("Initialize Game tx:", tx);

        const game = await program.account.game.fetch(gamePDA);
        expect(game.authority.toString()).to.equal(provider.wallet.publicKey.toString());
        expect(game.randomValue.toNumber()).to.equal(0);
        expect(game.shuffleComplete).to.equal(false);
      } catch (e: any) {
        // Account may already exist from previous run
        if (!e.message.includes("already in use")) {
          throw e;
        }
        console.log("Game already initialized, continuing...");
      }
    });

    it("initializes a player account", async () => {
      try {
        const tx = await program.methods
          .initializePlayer()
          .accounts({
            payer: provider.wallet.publicKey,
            owner: provider.wallet.publicKey,
            player: playerPDA,
            systemProgram: web3.SystemProgram.programId,
          })
          .rpc();

        console.log("Initialize Player tx:", tx);

        const player = await program.account.player.fetch(playerPDA);
        expect(player.owner.toString()).to.equal(provider.wallet.publicKey.toString());
        expect(player.publicScore.toNumber()).to.equal(0);
        expect(player.privateHand[0]).to.equal(0);
        expect(player.privateHand[1]).to.equal(0);
      } catch (e: any) {
        if (!e.message.includes("already in use")) {
          throw e;
        }
        console.log("Player already initialized, continuing...");
      }
    });

    it("sets player hand", async () => {
      const card1 = 42; // Some card value
      const card2 = 17; // Another card value

      const tx = await program.methods
        .setHand(card1, card2)
        .accounts({
          owner: provider.wallet.publicKey,
          player: playerPDA,
        })
        .rpc();

      console.log("Set Hand tx:", tx);

      const player = await program.account.player.fetch(playerPDA);
      expect(player.privateHand[0]).to.equal(card1);
      expect(player.privateHand[1]).to.equal(card2);
    });

    it("increments player score", async () => {
      const playerBefore = await program.account.player.fetch(playerPDA);
      const scoreBefore = playerBefore.publicScore.toNumber();

      const tx = await program.methods
        .incrementScore()
        .accounts({
          player: playerPDA,
        })
        .rpc();

      console.log("Increment Score tx:", tx);

      const playerAfter = await program.account.player.fetch(playerPDA);
      expect(playerAfter.publicScore.toNumber()).to.equal(scoreBefore + 1);
    });
  });

  // ============================================================
  // PART 2: VRF Tests (Requires MagicBlock DevNet)
  // ============================================================

  describe("Part 2: VRF Randomness (MagicBlock DevNet)", function () {
    this.timeout(60000); // VRF may take time

    // Skip if not on devnet with VRF access
    const skipVRF = !ephemeralRpcUrl.includes("magicblock");

    it("requests random number from VRF oracle", async function () {
      // Always skip on localnet - VRF requires MagicBlock infrastructure
      console.log("Skipping VRF test - requires MagicBlock DevNet (set EPHEMERAL_PROVIDER_ENDPOINT)");
      this.skip();
      return;

      // VRF Oracle Queue (use default from MagicBlock when connected)
      // const oracleQueue = new PublicKey("..."); // From ephemeral_vrf_sdk::consts::DEFAULT_QUEUE

      const tx = await program.methods
        .requestRandom(123) // client seed
        .accounts({
          payer: provider.wallet.publicKey,
          game: gamePDA,
          oracleQueue: oracleQueue,
        })
        .rpc();

      console.log("Request Random tx:", tx);

      // Wait for callback
      console.log("Waiting for VRF callback...");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const game = await program.account.game.fetch(gamePDA);
      console.log("Random value:", game.randomValue.toString());
      console.log("Shuffle complete:", game.shuffleComplete);

      // After VRF callback, these should be updated
      expect(game.shuffleComplete).to.equal(true);
      expect(game.randomValue.toNumber()).to.not.equal(0);
    });
  });

  // ============================================================
  // PART 3: Ephemeral Rollup Tests
  // ============================================================

  describe("Part 3: Ephemeral Rollup Delegation", function () {
    this.timeout(120000); // Delegation may take time

    // Skip - delegation requires MagicBlock delegation program which isn't on local validator
    it("delegates player account to Ephemeral Rollup", async function () {
      console.log("Skipping delegation test - requires MagicBlock infrastructure");
      console.log("To test: deploy to devnet and connect to MagicBlock ER endpoint");
      this.skip();
      return;

      // This code would work when connected to MagicBlock:

      // Get validator pubkey for remaining accounts (local vs devnet)
      const remainingAccounts = ephemeralRpcUrl.includes("localhost")
        ? [
            {
              pubkey: new PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
              isSigner: false,
              isWritable: false,
            },
          ]
        : [];

      const tx = await program.methods
        .delegatePlayer()
        .accounts({
          payer: provider.wallet.publicKey,
          owner: provider.wallet.publicKey,
          player: playerPDA,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();

      console.log("Delegate Player tx:", tx);
      console.log("Player account delegated to ER");
    });

    it("modifies player state on Ephemeral Rollup", async function () {
      console.log("Skipping ER modification test - requires MagicBlock infrastructure");
      this.skip();
      return;

      // Use ER provider for this transaction
      const programER = new Program(program.idl, providerER);

      // Increment score on ER (should be faster)
      const start = Date.now();

      let tx = await programER.methods
        .incrementScore()
        .accounts({
          player: playerPDA,
        })
        .transaction();

      tx.feePayer = providerER.wallet.publicKey;
      tx.recentBlockhash = (await providerER.connection.getLatestBlockhash()).blockhash;
      tx = await providerER.wallet.signTransaction(tx);

      const txHash = await providerER.sendAndConfirm(tx);
      const duration = Date.now() - start;

      console.log(`${duration}ms (ER) Increment Score tx: ${txHash}`);

      // Verify on ER
      const player = await programER.account.player.fetch(playerPDA);
      console.log("Score after ER increment:", player.publicScore.toNumber());
    });

    it("undelegates player account back to base layer", async function () {
      console.log("Skipping undelegate test - requires MagicBlock infrastructure");
      this.skip();
      return;

      const programER = new Program(program.idl, providerER);

      let tx = await programER.methods
        .undelegatePlayer()
        .accounts({
          payer: providerER.wallet.publicKey,
          player: playerPDA,
        })
        .transaction();

      tx.feePayer = providerER.wallet.publicKey;
      tx.recentBlockhash = (await providerER.connection.getLatestBlockhash()).blockhash;
      tx = await providerER.wallet.signTransaction(tx);

      const txHash = await providerER.sendAndConfirm(tx);
      console.log("Undelegate tx:", txHash);

      // Wait for commitment on base layer
      console.log("Waiting for commitment on base layer...");
      const commitSig = await GetCommitmentSignature(txHash, providerER.connection);
      console.log("Commitment signature:", commitSig);

      // Verify on base layer
      const player = await program.account.player.fetch(playerPDA);
      console.log("Score after undelegate:", player.publicScore.toNumber());
    });
  });
});
