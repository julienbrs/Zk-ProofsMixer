import { ZkMixer } from './zkMixer';
import {
  AccountUpdate,
  Field,
  MerkleMap,
  Mina,
  Poseidon,
  PrivateKey,
} from 'snarkyjs';

import { deployAndInit, depositWrapper, withdrawWrapper } from './utils';
import { DepositNote, KeyPair, LocalState } from './types';

let proofsEnabled = false;

const DEPOSIT_AMOUNT: Array<bigint> = [
  BigInt(100000),
  BigInt(500000),
  BigInt(1000000),
];

describe('ZkMixer', () => {
  let app: ZkMixer,
    keys: KeyPair,
    deployer: KeyPair,
    users: KeyPair[],
    state: LocalState;

  beforeAll(() => {
    if (proofsEnabled) {
      ZkMixer.compile();
    }
  });

  beforeEach(async () => {
    let Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);

    // every local accounts except the first one is a user
    users = Local.testAccounts.slice(1) as KeyPair[];
    state = {
      localCommitmentsMap: new MerkleMap(),
      localNullifierHashedMap: new MerkleMap(),
    };

    let generatedPrivateKey = PrivateKey.random();
    keys = {
      publicKey: generatedPrivateKey.toPublicKey(),
      privateKey: generatedPrivateKey,
    };
    app = new ZkMixer(keys.publicKey);

    deployer = {
      publicKey: Local.testAccounts[0].publicKey,
      privateKey: Local.testAccounts[0].privateKey,
    };
    await deployAndInit(app, keys.privateKey, deployer);
  });

  it('should deploy', () => {
    expect(app).toBeDefined();
  });

  it('should initialize properly', () => {
    const initialCommitmentsRoot = app.commitmentsRoot.get();
    const initialNullifierHashesRoot = app.nullifierHashesRoot.get();

    expect(initialCommitmentsRoot).toStrictEqual(
      state.localCommitmentsMap.getRoot()
    );
    expect(initialNullifierHashesRoot).toStrictEqual(
      state.localNullifierHashedMap.getRoot()
    );
  });

  describe('deposit', () => {
    /**
     * User deposits Type1 which equals to 100000 tokens. No `addressToWithdraw` is specified,
     * so the deposit is withdrawable to any address that got the note
     */
    it('should successfully deposit Type1, withdrawable to any address', async () => {
      // get initial balances before deposit
      const initialUserBalance = Mina.getBalance(users[0].publicKey).toBigInt();
      const initialSCBalance = Mina.getBalance(app.address).toBigInt();
      const depositType1 = Field(1);

      await depositWrapper(app, state, depositType1, users[0]);

      // get final balances
      const finalUserBalance = Mina.getBalance(users[0].publicKey).toBigInt();
      const finalSCBalance = Mina.getBalance(app.address).toBigInt();

      // compare the root of the smart contract tree to our local tree
      expect(state.localCommitmentsMap.getRoot()).toStrictEqual(
        app.commitmentsRoot.get()
      );
      expect(finalUserBalance).toEqual(initialUserBalance - DEPOSIT_AMOUNT[0]);
      expect(finalSCBalance).toEqual(initialSCBalance + DEPOSIT_AMOUNT[0]);
    });

    it('should successfully deposit Type1, then deposit Type2', async () => {
      // get initial balances before deposit
      const initialUserBalance = Mina.getBalance(users[0].publicKey).toBigInt();
      const initialSCBalance = Mina.getBalance(app.address).toBigInt();
      const depositType1 = Field(1);

      await depositWrapper(app, state, depositType1, users[0]);

      // get final balances
      const finalUserBalance = Mina.getBalance(users[0].publicKey).toBigInt();
      const finalSCBalance = Mina.getBalance(app.address).toBigInt();

      // compare the root of the smart contract tree to our local tree
      expect(state.localCommitmentsMap.getRoot()).toStrictEqual(
        app.commitmentsRoot.get()
      );
      expect(finalUserBalance).toEqual(initialUserBalance - DEPOSIT_AMOUNT[0]);
      expect(finalSCBalance).toEqual(initialSCBalance + DEPOSIT_AMOUNT[0]);

      // deposit Type2
      const depositType2 = Field(2);
      await depositWrapper(app, state, depositType2, users[0]);

      // get final balances
      const finalUserBalance2 = Mina.getBalance(users[0].publicKey).toBigInt();
      const finalSCBalance2 = Mina.getBalance(app.address).toBigInt();

      // compare the root of the smart contract tree to our local tree
      expect(state.localCommitmentsMap.getRoot()).toStrictEqual(
        app.commitmentsRoot.get()
      );
      expect(finalUserBalance2).toEqual(finalUserBalance - DEPOSIT_AMOUNT[1]);
      expect(finalSCBalance2).toEqual(finalSCBalance + DEPOSIT_AMOUNT[1]);
    });

    it('should not deposit when caller does not have enough balance', async () => {
      const depositType1 = Field(1);

      // send almost all the balance of the user
      let transferTx = await Mina.transaction(users[0].publicKey, () => {
        AccountUpdate.createSigned(users[0].publicKey).send({
          to: deployer.publicKey,
          amount: 999999999999n,
        });
      });
      await transferTx.prove();
      await transferTx.sign([users[0].privateKey]).send();

      // balance of user is now less than the deposit amount, so deposit should fail
      await expect(
        depositWrapper(app, state, depositType1, users[0])
      ).rejects.toThrow();
    });

    it('should not deposit with invalid deposit type', async () => {
      const invalidDepositType = Field(4); // valid deposit types are 1, 2, 3

      await expect(
        depositWrapper(app, state, invalidDepositType, users[0])
      ).rejects.toThrow(Error);
    });

    it('should fail when doing twice the same commitment', async () => {
      const depositType1 = Field(1);
      const { nonce: depositNonce, nullifier } = await depositWrapper(
        app,
        state,
        depositType1,
        users[0]
      );

      // calculate the same commitment again...
      const sameCommitment = Poseidon.hash(
        [depositNonce.toFields(), nullifier, depositType1].flat()
      );
      const commitmentWitness =
        state.localCommitmentsMap.getWitness(sameCommitment);

      // ... and try to deposit it again
      await expect(
        Mina.transaction(users[0].publicKey, () => {
          app.deposit(sameCommitment, commitmentWitness, depositType1);
        })
      ).rejects.toThrow();
    });

    describe('addressToWithdraw specified when depositing', () => {
      /**
       * User deposits Type1 which equals to 100000 tokens. The `addressToWithdraw` is set to the user's address,
       * This is not a real use case, but it's useful for testing purposes
       */
      it('should deposit when addressToWithdraw is defined and is sender address', async () => {
        const depositType1 = Field(1);
        const addressToWithdrawField = users[0].publicKey.toFields()[0];

        // get initial balances
        const initialUserBalance = Mina.getBalance(
          users[0].publicKey
        ).toBigInt();
        const initialSCBalance = Mina.getBalance(app.address).toBigInt();

        await depositWrapper(
          app,
          state,
          depositType1,
          users[0],
          addressToWithdrawField
        );

        // get final balances
        const finalUserBalance = Mina.getBalance(users[0].publicKey).toBigInt();
        const finalSCBalance = Mina.getBalance(app.address).toBigInt();

        // compare the nullifier tree to our local tree
        expect(state.localNullifierHashedMap.getRoot()).toStrictEqual(
          app.nullifierHashesRoot.get()
        );

        // check balances
        expect(finalUserBalance).toEqual(
          initialUserBalance - DEPOSIT_AMOUNT[0]
        );
        expect(finalSCBalance).toEqual(initialSCBalance + DEPOSIT_AMOUNT[0]);
      });

      /**
       * User deposits Type1 which equals to 100000 tokens. The `addressToWithdraw` is set to the deployer's address,
       * so the deposit is withdrawable only to the deployer's address
       */
      it('user should deposit and plan to withdraw to deployer address', async () => {
        const depositType = Field(1);
        const withdrawAddressField = deployer.publicKey.toFields()[0]; // deployer is not the sender

        // get initial balances
        const initialUserBalance = Mina.getBalance(
          users[0].publicKey
        ).toBigInt();
        const initialSCBalance = Mina.getBalance(app.address).toBigInt();

        await depositWrapper(
          app,
          state,
          depositType,
          users[0],
          withdrawAddressField
        );

        // get final balances
        const finalUserBalance = Mina.getBalance(users[0].publicKey).toBigInt();
        const finalSCBalance = Mina.getBalance(app.address).toBigInt();

        // compare the nullifier tree to our local tree
        expect(state.localNullifierHashedMap.getRoot()).toStrictEqual(
          app.nullifierHashesRoot.get()
        );
        // check balances
        expect(finalUserBalance).toEqual(
          initialUserBalance - DEPOSIT_AMOUNT[0]
        );
        expect(finalSCBalance).toEqual(initialSCBalance + DEPOSIT_AMOUNT[0]);
      });
    });
  });

  describe('withdraw', () => {
    /**
     * User deposits Type1 which equals to 100000 tokens. No `addressToWithdraw` is specified.
     * User then withdraws the deposit to his own address.
     */
    it('should withdraw successfully a deposit of Type1 withdrawable to any address', async () => {
      // User do a deposit of Type1
      const depositType1 = Field(1);
      const note1 = await depositWrapper(app, state, depositType1, users[0]);

      // get balances before withdrawal
      const userBalanceBeforeWithdraw = Mina.getBalance(
        users[0].publicKey
      ).toBigInt();
      const SCBalanceBeforeWithdraw = Mina.getBalance(app.address).toBigInt();

      // user withdraws the deposit
      await withdrawWrapper(app, state, users[0], note1);

      // get final balances
      const finalUserBalance = Mina.getBalance(users[0].publicKey).toBigInt();
      const finalSCBalance = Mina.getBalance(app.address).toBigInt();

      // compare the nullifier tree to our local tree
      expect(state.localNullifierHashedMap.getRoot()).toStrictEqual(
        app.nullifierHashesRoot.get()
      );
      // check balances
      expect(finalUserBalance).toEqual(
        userBalanceBeforeWithdraw + DEPOSIT_AMOUNT[0]
      );
      expect(finalSCBalance).toEqual(
        SCBalanceBeforeWithdraw - DEPOSIT_AMOUNT[0]
      );
    });

    it('should not allow withdrawal without an existing deposit', async () => {
      const emptyNote: DepositNote = {
        nonce: Mina.getAccount(users[0].publicKey).nonce,
        commitment: Field.random(),
        nullifier: Field.random(),
        depositType: Field(1),
      };

      await expect(
        withdrawWrapper(app, state, users[0], emptyNote)
      ).rejects.toThrow();
    });

    it('should not allow double withdrawal for the same deposit', async () => {
      const depositType1 = Field(1);

      // deposit
      const note = await depositWrapper(app, state, depositType1, users[0]);

      // First withdrawal should succeed
      await withdrawWrapper(app, state, users[0], note);

      // Second withdrawal attempt with the same nullifier should fail
      await expect(
        withdrawWrapper(app, state, users[0], note)
      ).rejects.toThrow();
    });

    it('should not allow a withdrawal of type different than the deposit type', async () => {
      const depositType1 = Field(1);
      const note = await depositWrapper(app, state, depositType1, users[0]);

      // Attempt to withdraw a Type2 deposit while it's a Type1 deposit
      await expect(
        withdrawWrapper(app, state, users[0], note)
      ).rejects.toThrow();
    });

    /**
     * Deposit types are equal to 1, 2 or 3 and nothing else.
     */
    it('should not allow withdrawal of invalid type', async () => {
      const invalidType = Field(4); // Invalid type
      const userNonce = Mina.getAccount(users[0].publicKey).nonce;
      const nullifier = Field.random();

      const invalidDepositNote: DepositNote = {
        nonce: userNonce,
        commitment: Field.random(),
        nullifier,
        depositType: invalidType,
      };

      // Attempt to deposit an invalid type
      await expect(
        depositWrapper(app, state, invalidType, users[0])
      ).rejects.toThrow();

      // Attempt to withdraw an invalid type
      await expect(
        withdrawWrapper(app, state, users[0], invalidDepositNote)
      ).rejects.toThrow();
    });

    it('should not allow withdrawal with invalid nullifier', async () => {
      const depositType1 = Field(1);
      const note = await depositWrapper(app, state, depositType1, users[0]);

      // Attempt to withdraw with an invalid nullifier
      await expect(
        withdrawWrapper(app, state, users[0], note)
      ).rejects.toThrow();
    });

    describe('addressToWithdraw specified when withdrawing', () => {
      it('user deposit and plan to withdraw to user. user should be able to withdraw', async () => {
        const depositType1 = Field(1);
        const addressToWithdraw = users[0].publicKey.toFields()[0];

        // get initial balances
        const initialUserBalance = Mina.getBalance(
          users[0].publicKey
        ).toBigInt();
        const initialSCBalance = Mina.getBalance(app.address).toBigInt();

        // deposit, only user is allowed to withdraw
        const note = await depositWrapper(
          app,
          state,
          depositType1,
          users[0],
          addressToWithdraw
        );

        // user withdraws the deposit
        await withdrawWrapper(app, state, users[0], note);

        // get final balances
        const finalUserBalance = Mina.getBalance(users[0].publicKey).toBigInt();
        const finalSCBalance = Mina.getBalance(app.address).toBigInt();

        // compare the nullifier tree to our local tree
        expect(state.localNullifierHashedMap.getRoot()).toStrictEqual(
          app.nullifierHashesRoot.get()
        );
        // check balances, nothing should change since user withdraws to himself
        expect(finalUserBalance).toEqual(initialUserBalance);
        expect(finalSCBalance).toEqual(initialSCBalance);
      });

      it('user deposit and plan to withdraw to deployer. Deployer should be able to withdraw', async () => {
        const depositType1 = Field(1);
        const addressToWithdraw = deployer.publicKey.toFields()[0];

        // get initial balances
        const initialUserBalance = Mina.getBalance(
          users[0].publicKey
        ).toBigInt();
        const initialDeployerBalance = Mina.getBalance(
          deployer.publicKey
        ).toBigInt();
        const initialSCBalance = Mina.getBalance(app.address).toBigInt();

        // deposit, only deployer is allowed to withdraw
        const note = await depositWrapper(
          app,
          state,
          depositType1,
          users[0],
          addressToWithdraw
        );

        // deployer withdraws to him
        await withdrawWrapper(app, state, deployer, note);

        // get final balances
        const finalUserBalance = Mina.getBalance(users[0].publicKey).toBigInt();
        const finalDeployerBalance = Mina.getBalance(
          deployer.publicKey
        ).toBigInt();
        const finalSCBalance = Mina.getBalance(app.address).toBigInt();

        // compare the nullifier tree to our local tree
        expect(state.localNullifierHashedMap.getRoot()).toStrictEqual(
          app.nullifierHashesRoot.get()
        );
        // check balances
        expect(finalUserBalance).toEqual(
          initialUserBalance - DEPOSIT_AMOUNT[0]
        );
        expect(finalDeployerBalance).toEqual(
          initialDeployerBalance + DEPOSIT_AMOUNT[0]
        );
        expect(finalSCBalance).toEqual(initialSCBalance);
      });

      it('user deposit and plan to withdraw to deployer. user (and anyone else except deployer) should not be able to withdraw', async () => {
        const depositType1 = Field(1);
        const addressToWithdraw = deployer.publicKey.toFields()[0];
        // specific address expected is deployer
        const note = await depositWrapper(
          app,
          state,
          depositType1,
          users[0],
          addressToWithdraw
        );

        // deployer withdraws to him
        await expect(
          withdrawWrapper(app, state, users[0], note)
        ).rejects.toThrow();
      });
    });
  });
});
