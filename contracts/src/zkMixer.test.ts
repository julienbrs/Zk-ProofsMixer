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
   * */
  async function depositWrapper(
    depositType: Field,
    caller: PublicKey,
    addressToWithdraw: Field = Field(0)
  ) {
    // get caller's information
    const callerAccount = Mina.getAccount(caller);
    const callerNonce = callerAccount.nonce;
    const nullifier = Field.random();

    // calculate the new commitment. If `addressToWithdraw` is Field(0), then it won't change the hash
    // and the deposit will be withdrawable to any address that got the note
    const newCommitment = Poseidon.hash(
      [callerNonce.toFields(), nullifier, depositType, addressToWithdraw].flat()
    );

    // get the witness for the current tree...
    const commitmentWitness = commitmentMap.getWitness(newCommitment);
    // ... and update the leaf locally
    commitmentMap.set(newCommitment, depositType);

    // on-chain deposit
    const depositTx = await Mina.transaction(caller, () => {
      zkMixer.deposit(newCommitment, commitmentWitness, depositType);
    });
    await depositTx.prove();
    await depositTx.sign([userKey]).send();

    // return necessary information for withdrawal
    return { callerNonce, nullifier };
  }

  async function withdraw(
    callerNonce: UInt32,
    nullifier: Field,
    caller: PublicKey,
    depositType: Field,
    specificAddress: PublicKey | null
  ) {
    let specificAddressField: Field;
    if (specificAddress !== null) {
      specificAddressField = specificAddress.toFields()[0];
    } else {
      specificAddressField = Field(0);
    }

    const commitment = Poseidon.hash(
      [callerNonce.toFields(), nullifier, Field(1), specificAddressField].flat()
    );

    // get the witness for the current tree
    const commitmentWitness = commitmentMap.getWitness(commitment);
    const nullifierWitness = nullifierHashedMap.getWitness(nullifier);
    // update the leaf locally
    commitmentMap.set(commitment, Field(1));

    const callerKey = caller === deployer ? deployerKey : userKey;
    const withdrawTx = await Mina.transaction(caller, () => {
      zkMixer.withdraw(
        nullifier,
        nullifierWitness,
        commitmentWitness,
        callerNonce,
        depositType,
        specificAddressField
      );
    });
    await withdrawTx.prove();
    await withdrawTx.sign([callerKey]).send();

    nullifierHashedMap.set(nullifier, Field(1));
  }

  it('should deploy', () => {
    expect(zkMixer).toBeDefined();
  });

  it('should initialize', () => {
    const initialCommitmentsRoot = zkMixer.commitmentsRoot.get();
    const initialNullifierHashesRoot = zkMixer.nullifierHashesRoot.get();

    expect(initialCommitmentsRoot).toStrictEqual(commitmentMap.getRoot());
    expect(initialNullifierHashesRoot).toStrictEqual(
      nullifierHashedMap.getRoot()
    );
  });

  describe('deposit', () => {
    it('should deposit type 1', async () => {
      // get initial balances
      const initialUserBalance = Mina.getBalance(user).toBigInt();
      const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

      const depositType = Field(1);
      await depositWrapper(depositType, user);

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

    it('should not deposit with zero balance', async () => {
      const depositType = Field(1);

      // account empty without balance
      let transferTx = await Mina.transaction(user, () => {
        AccountUpdate.createSigned(user).send({
          to: deployer,
          amount: 999999999999n,
        });
      });
      await transferTx.prove();
      await transferTx.sign([userKey]).send();
      await expect(depositWrapper(depositType, user)).rejects.toThrow();
    });

    it('should not deposit with invalid deposit type', async () => {
      const depositType = Field(4); // An invalid deposit type

      await expect(depositWrapper(depositType, user)).rejects.toThrow(Error);
    });

    it('should fail when doing twice the same commitment', async () => {
      const depositType = Field(1);
      const { callerNonce, nullifier } = await depositWrapper(
        depositType,
        user
      );

      // calculate the same commitment again
      const sameCommitment = Poseidon.hash(
        [callerNonce.toFields(), nullifier, depositType].flat()
      );
      const commitmentWitness = commitmentMap.getWitness(sameCommitment);

      try {
        const sameDepositTx = await Mina.transaction(user, () => {
          zkMixer.deposit(sameCommitment, commitmentWitness, depositType);
        });
        await sameDepositTx.prove();
        await sameDepositTx.sign([userKey]).send();
        expect(false).toBe(true); // If we reach this line, the test should fail

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        expect(error.message).toContain('Field.assertEquals():');
      }
    });

    describe('feature: lockAddress', () => {
      it('should deposit when lockAddress is defined and is sender address', async () => {
        const depositType = Field(1);
        const withdrawAddressField = user.toFields()[0];

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

      it('should deposit when lockAddress is defined and different from sender address', async () => {
        const depositType = Field(1);
        const withdrawAddressField = deployer.toFields()[0];

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
    it('should withdraw type 1', async () => {
      // deposit type 1
      const depositType = Field(1);
      const { callerNonce, nullifier } = await depositWrapper(
        depositType,
        user
      );

      // get initial balances
      const initialUserBalance = Mina.getBalance(user).toBigInt();
      const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

      // withdraw type 1
      await withdraw(callerNonce, nullifier, user, depositType, null);

      // get final balances
      const finalUserBalance = Mina.getBalance(user).toBigInt();
      const finalSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

      // compare the nullifier tree to our local tree
      expect(nullifierHashedMap.getRoot()).toStrictEqual(
        zkMixer.nullifierHashesRoot.get()
      );
      // check balances
      expect(finalUserBalance).toEqual(initialUserBalance + DEPOSIT_AMOUNT[0]);
      expect(finalSCBalance).toEqual(initialSCBalance - DEPOSIT_AMOUNT[0]);
    });
    it('should not allow withdrawal without deposit', async () => {
      const depositType = Field(1);
      const nullifier = Field.random();
      const userNonce = Mina.getAccount(user).nonce;

      await expect(
        withdraw(userNonce, nullifier, user, depositType, null)
      ).rejects.toThrow();
    });

    it('should not allow double spending', async () => {
      const depositType = Field(1);
      const { callerNonce, nullifier } = await depositWrapper(
        depositType,
        user
      );

      // First withdrawal should succeed
      await withdraw(callerNonce, nullifier, user, depositType, null);

      // Second withdrawal attempt with the same nullifier should fail
      await expect(
        withdraw(callerNonce, nullifier, user, depositType, null)
      ).rejects.toThrow();
    });

    it('should not allow withdrawal of different type', async () => {
      const depositType = Field(1);
      const differentWithdrawType = Field(2);
      const { callerNonce, nullifier } = await depositWrapper(
        depositType,
        user
      );

      // Attempt to withdraw a different type than what was deposited
      await expect(
        withdraw(callerNonce, nullifier, user, differentWithdrawType, null)
      ).rejects.toThrow();
    });

    it('should not allow withdrawal of invalid type', async () => {
      const depositType = Field(4); // Invalid type
      const userNonce = Mina.getAccount(user).nonce;
      const nullifier = Field.random();

      // Attempt to deposit an invalid type
      await expect(depositWrapper(depositType, user)).rejects.toThrow();

      // Attempt to withdraw an invalid type
      await expect(
        withdraw(userNonce, nullifier, user, depositType, null)
      ).rejects.toThrow();
    });

    it('should not allow withdrawal with invalid nullifier', async () => {
      const depositType = Field(1);
      const { callerNonce } = await depositWrapper(depositType, user);
      const nullifier = Field.random();

      // Attempt to withdraw with an invalid nullifier
      await expect(
        withdraw(callerNonce, nullifier, user, depositType, null)
      ).rejects.toThrow();
    });
    describe('feature: lockAddress', () => {
      it('user deposit and plan to withdraw to user. user should be able to withdraw', async () => {
        const depositType = Field(1);
        const withdrawAddressField = user.toFields()[0];

        // get initial balances
        const initialUserBalance = Mina.getBalance(user).toBigInt();
        const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

        // specific address expected is user
        const { userNonce, nullifier } = await deposit(
          depositType,
          user,
          withdrawAddressField
        );

        // try to withdraw to deployer when lockAddress is user
        await withdraw(userNonce, nullifier, user, depositType, user);

        // get final balances
        const finalUserBalance = Mina.getBalance(user).toBigInt();
        const finalSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

        // compare the nullifier tree to our local tree
        expect(nullifierHashedMap.getRoot()).toStrictEqual(
          zkMixer.nullifierHashesRoot.get()
        );
        // check balances
        expect(finalUserBalance).toEqual(initialUserBalance);
        expect(finalSCBalance).toEqual(initialSCBalance);
      });

      it('user deposit and plan to withdraw to deployer. Deployer should be able to withdraw', async () => {
        const depositType = Field(1);
        const withdrawAddressField = deployer.toFields()[0];

        // get initial balances
        const initialUserBalance = Mina.getBalance(user).toBigInt();
        const initialDeployerBalance = Mina.getBalance(deployer).toBigInt();
        const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

        // specific address expected is deployer
        const { callerNonce, nullifier } = await depositWrapper(
          depositType,
          user,
          withdrawAddressField
        );

        // deployer withdraws to him
        await withdraw(callerNonce, nullifier, deployer, depositType, deployer);

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

      it('user deposit and plan to withdraw to deployer. user should not be able to withdraw', async () => {
        const depositType = Field(1);
        const withdrawAddressField = deployer.toFields()[0];
        // specific address expected is deployer
        const { callerNonce, nullifier } = await depositWrapper(
          depositType,
          user,
          withdrawAddressField
        );

        // deployer withdraws to him
        await expect(
          withdraw(callerNonce, nullifier, user, depositType, deployer)
        ).rejects.toThrow();
      });
    });
  });
});
