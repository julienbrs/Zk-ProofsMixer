import { ZkMixer } from './zkMixer';
import {
  AccountUpdate,
  Field,
  MerkleMap,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
  UInt32,
} from 'snarkyjs';

let proofsEnabled = false;

const DEPOSIT_AMOUNT: Array<bigint> = [
  BigInt(100000),
  BigInt(500000),
  BigInt(1000000),
];

describe('ZkMixer', () => {
  let zkMixer: ZkMixer,
    deployer: PublicKey,
    deployerKey: PrivateKey,
    user: PublicKey,
    userKey: PrivateKey,
    zkMixerPrivateKey: PrivateKey,
    zkMixerPublicKey: PublicKey,
    Local: any,
    commitmentMap: MerkleMap,
    nullifierHashedMap: MerkleMap;

  beforeAll(() => {
    if (proofsEnabled) {
      ZkMixer.compile();
    }
  });

  beforeEach(async () => {
    Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);

    commitmentMap = new MerkleMap();
    nullifierHashedMap = new MerkleMap();

    deployer = Local.testAccounts[0].publicKey;
    deployerKey = Local.testAccounts[0].privateKey;
    user = Local.testAccounts[1].publicKey;
    userKey = Local.testAccounts[1].privateKey;

    zkMixerPrivateKey = PrivateKey.random();
    zkMixerPublicKey = zkMixerPrivateKey.toPublicKey();
    zkMixer = new ZkMixer(zkMixerPublicKey);

    const deployTxn = await Mina.transaction(deployer, () => {
      AccountUpdate.fundNewAccount(deployer);
      zkMixer.deploy();
    });
    await deployTxn.prove();
    await deployTxn.sign([deployerKey, zkMixerPrivateKey]).send();

    const initTxn = await Mina.transaction(deployer, () => {
      zkMixer.initState(commitmentMap.getRoot(), nullifierHashedMap.getRoot());
    });
    await initTxn.prove();
    await initTxn.sign([deployerKey]).send();
  });

  /* depositWrapper is a helper function that deposits to the zkMixer contract and returns the user's nonce and nullifier
   * @param depositType - the type of deposit to make
   * @param user - the caller's public key
   * @param addressToWithdraw - the address to withdraw to, if null then it is withdrawable to any address
   * that got the note
   * @returns {userNonce, nullifier} - the user's nonce and nullifier
   */
  async function depositWrapper(
    depositType: Field,
    caller: PublicKey,
    addressToWithdraw: Field = Field(0)
  ) {
    // get caller's information
    const callerAccount = Mina.getAccount(caller);
    const depositNonce = callerAccount.nonce;
    const nullifier = Field.random();

    // calculate the new commitment. If `addressToWithdraw` is Field(0), then it won't change the hash
    // and the deposit will be withdrawable to any address that got the note
    const newCommitment = Poseidon.hash(
      [
        depositNonce.toFields(),
        nullifier,
        depositType,
        addressToWithdraw,
      ].flat()
    );

    // get the witness for the current tree
    const commitmentWitness = commitmentMap.getWitness(newCommitment);

    // on-chain deposit
    const depositTx = await Mina.transaction(caller, () => {
      zkMixer.deposit(newCommitment, commitmentWitness, depositType);
    });
    await depositTx.prove();
    await depositTx.sign([userKey]).send();

    // update the leaf locally if the deposit was successful
    commitmentMap.set(newCommitment, depositType);

    // return necessary information for withdrawal
    return { depositNonce, nullifier };
  }

  /* withdrawWrapper is a helper function that withdraws from the zkMixer contract
   * @param oldNonce - the nonce used when depositing
   * @param nullifier - the nullifier of the note to withdraw
   * @param caller - the caller's public key
   * @param depositType - the type of deposit to make
   * @param addressToWithdraw - the address to withdraw to, if null then it is withdrawable to any address
   * that got the note
   */
  async function withdrawWrapper(
    oldNonce: UInt32,
    nullifier: Field,
    caller: PublicKey,
    depositType: Field,
    addressToWithdraw: PublicKey | null
  ) {
    // if `addressToWithdraw` is null, then `addressToWithdrawField` will be Field(0) so it won't change the hash
    let addressToWithdrawField: Field;
    if (addressToWithdraw === null) {
      addressToWithdrawField = Field(0);
    } else {
      addressToWithdrawField = addressToWithdraw.toFields()[0];
    }

    // calculate the expected commitment used when depositing
    const expectedCommitment = Poseidon.hash(
      [oldNonce.toFields(), nullifier, Field(1), addressToWithdrawField].flat()
    );

    // hash the nullifier
    const nullifierHashed = Poseidon.hash([nullifier]);

    // get witnesses for the current tree...
    const commitmentWitness = commitmentMap.getWitness(expectedCommitment);
    const nullifierWitness = nullifierHashedMap.getWitness(nullifierHashed);
    // ... and update the leaf locally
    commitmentMap.set(expectedCommitment, Field(1));

    // get the caller's key (either deployer or user in that file)
    const callerKey = caller === deployer ? deployerKey : userKey;

    // on-chain withdrawal
    const withdrawTx = await Mina.transaction(caller, () => {
      zkMixer.withdraw(
        nullifier,
        nullifierWitness,
        commitmentWitness,
        oldNonce,
        depositType,
        addressToWithdrawField
      );
    });
    await withdrawTx.prove();
    await withdrawTx.sign([callerKey]).send();

    // update the nullifier hash map if the withdrawal was successful
    nullifierHashedMap.set(nullifierHashed, Field(1));
  }

  it('should deploy', () => {
    expect(zkMixer).toBeDefined();
  });

  it('should initialize properly', () => {
    const initialCommitmentsRoot = zkMixer.commitmentsRoot.get();
    const initialNullifierHashesRoot = zkMixer.nullifierHashesRoot.get();

    expect(initialCommitmentsRoot).toStrictEqual(commitmentMap.getRoot());
    expect(initialNullifierHashesRoot).toStrictEqual(
      nullifierHashedMap.getRoot()
    );
  });

  describe('deposit', () => {
    /**
     * User deposits Type1 which equals to 100000 tokens. No `addressToWithdraw` is specified,
     * so the deposit is withdrawable to any address that got the note
     */
    it('should successfully deposit Type1, withdrawable to any address', async () => {
      // get initial balances before deposit
      const initialUserBalance = Mina.getBalance(user).toBigInt();
      const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();
      const depositType1 = Field(1);

      await depositWrapper(depositType1, user);

      // get final balances
      const finalUserBalance = Mina.getBalance(user).toBigInt();
      const finalSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

      // compare the root of the smart contract tree to our local tree
      expect(commitmentMap.getRoot()).toStrictEqual(
        zkMixer.commitmentsRoot.get()
      );
      expect(finalUserBalance).toEqual(initialUserBalance - DEPOSIT_AMOUNT[0]);
      expect(finalSCBalance).toEqual(initialSCBalance + DEPOSIT_AMOUNT[0]);
    });

    it('should not deposit when caller does not have enough balance', async () => {
      const depositType1 = Field(1);

      // send almost all the balance of the user
      let transferTx = await Mina.transaction(user, () => {
        AccountUpdate.createSigned(user).send({
          to: deployer,
          amount: 999999999999n,
        });
      });
      await transferTx.prove();
      await transferTx.sign([userKey]).send();

      // balance of user is now less than the deposit amount, so deposit should fail
      await expect(depositWrapper(depositType1, user)).rejects.toThrow();
    });

    it('should not deposit with invalid deposit type', async () => {
      const invalidDepositType = Field(4); // valid deposit types are 1, 2, 3

      await expect(depositWrapper(invalidDepositType, user)).rejects.toThrow(
        Error
      );
    });

    it('should fail when doing twice the same commitment', async () => {
      const depositType1 = Field(1);
      const { depositNonce, nullifier } = await depositWrapper(
        depositType1,
        user
      );

      // calculate the same commitment again...
      const sameCommitment = Poseidon.hash(
        [depositNonce.toFields(), nullifier, depositType1].flat()
      );
      const commitmentWitness = commitmentMap.getWitness(sameCommitment);

      // ... and try to deposit it again
      await expect(
        Mina.transaction(user, () => {
          zkMixer.deposit(sameCommitment, commitmentWitness, depositType1);
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
        const addressToWithdrawField = user.toFields()[0];

        // get initial balances
        const initialUserBalance = Mina.getBalance(user).toBigInt();
        const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

        await depositWrapper(depositType1, user, addressToWithdrawField);

        // get final balances
        const finalUserBalance = Mina.getBalance(user).toBigInt();
        const finalSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

        // compare the nullifier tree to our local tree
        expect(nullifierHashedMap.getRoot()).toStrictEqual(
          zkMixer.nullifierHashesRoot.get()
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
        const withdrawAddressField = deployer.toFields()[0]; // deployer is not the sender

        // get initial balances
        const initialUserBalance = Mina.getBalance(user).toBigInt();
        const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

        await depositWrapper(depositType, user, withdrawAddressField);

        // get final balances
        const finalUserBalance = Mina.getBalance(user).toBigInt();
        const finalSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

        // compare the nullifier tree to our local tree
        expect(nullifierHashedMap.getRoot()).toStrictEqual(
          zkMixer.nullifierHashesRoot.get()
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
      const { depositNonce, nullifier } = await depositWrapper(
        depositType1,
        user
      );

      // get balances before withdrawal
      const userBalanceBeforeWithdraw = Mina.getBalance(user).toBigInt();
      const SCBalanceBeforeWithdraw = Mina.getBalance(
        zkMixer.address
      ).toBigInt();

      // user withdraws the deposit
      await withdrawWrapper(depositNonce, nullifier, user, depositType1, null);

      // get final balances
      const finalUserBalance = Mina.getBalance(user).toBigInt();
      const finalSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

      // compare the nullifier tree to our local tree
      expect(nullifierHashedMap.getRoot()).toStrictEqual(
        zkMixer.nullifierHashesRoot.get()
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
      const depositType = Field(1);
      const nullifier = Field.random();
      const userNonce = Mina.getAccount(user).nonce;

      await expect(
        withdrawWrapper(userNonce, nullifier, user, depositType, null)
      ).rejects.toThrow();
    });

    it('should not allow double withdrawal for the same deposit', async () => {
      const depositType1 = Field(1);

      // deposit
      const { depositNonce, nullifier } = await depositWrapper(
        depositType1,
        user
      );

      // First withdrawal should succeed
      await withdrawWrapper(depositNonce, nullifier, user, depositType1, null);

      // Second withdrawal attempt with the same nullifier should fail
      await expect(
        withdrawWrapper(depositNonce, nullifier, user, depositType1, null)
      ).rejects.toThrow();
    });

    it('should not allow a withdrawal of type different than the deposit type', async () => {
      const depositType1 = Field(1);
      const differentWithdrawType = Field(2);
      const { depositNonce, nullifier } = await depositWrapper(
        depositType1,
        user
      );

      // Attempt to withdraw a Type2 deposit while it's a Type1 deposit
      await expect(
        withdrawWrapper(
          depositNonce,
          nullifier,
          user,
          differentWithdrawType,
          null
        )
      ).rejects.toThrow();
    });

    /**
     * Deposit types are equal to 1, 2 or 3 and nothing else.
     */
    it('should not allow withdrawal of invalid type', async () => {
      const invalidType = Field(4); // Invalid type
      const userNonce = Mina.getAccount(user).nonce;
      const nullifier = Field.random();

      // Attempt to deposit an invalid type
      await expect(depositWrapper(invalidType, user)).rejects.toThrow();

      // Attempt to withdraw an invalid type
      await expect(
        withdrawWrapper(userNonce, nullifier, user, invalidType, null)
      ).rejects.toThrow();
    });

    it('should not allow withdrawal with invalid nullifier', async () => {
      const depositType1 = Field(1);
      const { depositNonce } = await depositWrapper(depositType1, user);
      const randomNullifier = Field.random();

      // Attempt to withdraw with an invalid nullifier
      await expect(
        withdrawWrapper(depositNonce, randomNullifier, user, depositType1, null)
      ).rejects.toThrow();
    });

    describe('addressToWithdraw specified when withdrawing', () => {
      it('user deposit and plan to withdraw to user. user should be able to withdraw', async () => {
        const depositType1 = Field(1);
        const addressToWithdraw = user.toFields()[0];

        // get initial balances
        const initialUserBalance = Mina.getBalance(user).toBigInt();
        const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

        // deposit, only user is allowed to withdraw
        const { depositNonce, nullifier } = await depositWrapper(
          depositType1,
          user,
          addressToWithdraw
        );

        // user withdraws the deposit
        await withdrawWrapper(
          depositNonce,
          nullifier,
          user,
          depositType1,
          user
        );

        // get final balances
        const finalUserBalance = Mina.getBalance(user).toBigInt();
        const finalSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

        // compare the nullifier tree to our local tree
        expect(nullifierHashedMap.getRoot()).toStrictEqual(
          zkMixer.nullifierHashesRoot.get()
        );
        // check balances, nothing should change since user withdraws to himself
        expect(finalUserBalance).toEqual(initialUserBalance);
        expect(finalSCBalance).toEqual(initialSCBalance);
      });

      it('user deposit and plan to withdraw to deployer. Deployer should be able to withdraw', async () => {
        const depositType1 = Field(1);
        const addressToWithdraw = deployer.toFields()[0];

        // get initial balances
        const initialUserBalance = Mina.getBalance(user).toBigInt();
        const initialDeployerBalance = Mina.getBalance(deployer).toBigInt();
        const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

        // deposit, only deployer is allowed to withdraw
        const { depositNonce, nullifier } = await depositWrapper(
          depositType1,
          user,
          addressToWithdraw
        );

        // deployer withdraws to him
        await withdrawWrapper(
          depositNonce,
          nullifier,
          deployer,
          depositType1,
          deployer
        );

        // get final balances
        const finalUserBalance = Mina.getBalance(user).toBigInt();
        const finalDeployerBalance = Mina.getBalance(deployer).toBigInt();
        const finalSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

        // compare the nullifier tree to our local tree
        expect(nullifierHashedMap.getRoot()).toStrictEqual(
          zkMixer.nullifierHashesRoot.get()
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
        const addressToWithdraw = deployer.toFields()[0];
        // specific address expected is deployer
        const { depositNonce, nullifier } = await depositWrapper(
          depositType1,
          user,
          addressToWithdraw
        );

        // deployer withdraws to him
        await expect(
          withdrawWrapper(depositNonce, nullifier, user, depositType1, deployer)
        ).rejects.toThrow();
      });
    });
  });
});
