import { ZkMixer } from './zkMixer';
import {
  Account,
  AccountUpdate,
  Field,
  MerkleMap,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
  UInt32,
  UInt64,
} from 'snarkyjs';

let proofsEnabled = false;

const DEPOSIT_AMOUNT: Array<bigint> = [
  BigInt(100000),
  BigInt(500000),
  BigInt(1000000),
];

describe('ZkMixer', () => {
  let zkMixer: ZkMixer,
    zkMixerPrivateKey: PrivateKey,
    zkMixerPublicKey: PublicKey,
    userCommitments: MerkleMap,
    userNullifierHashes: MerkleMap,
    Local: any,
    deployer: PublicKey,
    deployerKey: PrivateKey,
    user: PublicKey,
    userKey: PrivateKey;

  beforeAll(() => {
    if (proofsEnabled) {
      ZkMixer.compile();
    }
  });

  beforeEach(async () => {
    Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
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

    userCommitments = new MerkleMap();
    userNullifierHashes = new MerkleMap();

    const initTxn = await Mina.transaction(deployer, () => {
      zkMixer.initState(
        userCommitments.getRoot(),
        userNullifierHashes.getRoot()
      );
    });
    await initTxn.prove();
    await initTxn.sign([deployerKey]).send();
  });

  async function deposit(depositType: Field, user: PublicKey) {
    const userAccount = Mina.getAccount(user);
    const userNonce = userAccount.nonce;
    const nullifier = Field.random();
    const commitment = Poseidon.hash(
      [userNonce.toFields(), nullifier, depositType].flat()
    );

    // get the witness for the current tree
    const witness = userCommitments.getWitness(commitment);
    // update the leaf locally
    userCommitments.set(commitment, depositType);

    const depositTx = await Mina.transaction(user, () => {
      zkMixer.deposit(commitment, witness, depositType);
    });
    await depositTx.prove();
    await depositTx.sign([userKey]).send();

    return { userNonce, nullifier };
  }

  async function withdraw(
    userNonce: UInt32,
    nullifier: Field,
    user: PublicKey,
    depositType: Field
  ) {
    const commitment = Poseidon.hash(
      [userNonce.toFields(), nullifier, Field(1)].flat()
    );

    // get the witness for the current tree
    const commitmentWitness = userCommitments.getWitness(commitment);
    const nullifierWitness = userNullifierHashes.getWitness(nullifier);
    // update the leaf locally
    userCommitments.set(commitment, Field(1));

    const withdrawTx = await Mina.transaction(user, () => {
      zkMixer.withdraw(
        nullifier,
        nullifierWitness,
        commitmentWitness,
        userNonce,
        depositType
      );
    });
    await withdrawTx.prove();
    await withdrawTx.sign([userKey]).send();

    userNullifierHashes.set(nullifier, Field(1));
  }

  it('should deploy', () => {
    expect(zkMixer).toBeDefined();
  });

  it('should initialize', () => {
    const initialCommitmentsRoot = zkMixer.commitmentsRoot.get();
    const initialNullifierHashesRoot = zkMixer.nullifierHashesRoot.get();

    expect(initialCommitmentsRoot).toStrictEqual(userCommitments.getRoot());
    expect(initialNullifierHashesRoot).toStrictEqual(
      userNullifierHashes.getRoot()
    );
  });

  describe('deposit', () => {
    it('should deposit type 1', async () => {
      // get initial balances
      const initialUserBalance = Mina.getBalance(user).toBigInt();
      const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

      const depositType = Field(1);
      await deposit(depositType, user);

      // get final balances
      const finalUserBalance = Mina.getBalance(user).toBigInt();
      const finalSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

      // compare the root of the smart contract tree to our local tree
      expect(userCommitments.getRoot()).toStrictEqual(
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
      await expect(deposit(depositType, user)).rejects.toThrow();
    });

    it('should not deposit with invalid deposit type', async () => {
      const depositType = Field(4); // An invalid deposit type

      await expect(deposit(depositType, user)).rejects.toThrow(Error);
    });

    it('should fail when doing twice the same commitment', async () => {
      const depositType = Field(1);
      const { userNonce, nullifier } = await deposit(depositType, user);

      // calculate the same commitment again
      const sameCommitment = Poseidon.hash(
        [userNonce.toFields(), nullifier, depositType].flat()
      );
      const commitmentWitness = userCommitments.getWitness(sameCommitment);

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
  });

  describe('withdraw', () => {
    it('should withdraw type 1', async () => {
      // deposit type 1
      const depositType = Field(1);
      const { userNonce, nullifier } = await deposit(depositType, user);

      // get initial balances
      const initialUserBalance = Mina.getBalance(user).toBigInt();
      const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

      // withdraw type 1
      await withdraw(userNonce, nullifier, user, depositType);

      // get final balances
      const finalUserBalance = Mina.getBalance(user).toBigInt();
      const finalSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

      // compare the nullifier tree to our local tree
      expect(userNullifierHashes.getRoot()).toStrictEqual(
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
        withdraw(userNonce, nullifier, user, depositType)
      ).rejects.toThrow();
    });

    it('should not allow double spending', async () => {
      const depositType = Field(1);
      const { userNonce, nullifier } = await deposit(depositType, user);

      // First withdrawal should succeed
      await withdraw(userNonce, nullifier, user, depositType);

      // Second withdrawal attempt with the same nullifier should fail
      await expect(
        withdraw(userNonce, nullifier, user, depositType)
      ).rejects.toThrow();
    });

    it('should not allow withdrawal of different type', async () => {
      const depositType = Field(1);
      const differentWithdrawType = Field(2);
      const { userNonce, nullifier } = await deposit(depositType, user);

      // Attempt to withdraw a different type than what was deposited
      await expect(
        withdraw(userNonce, nullifier, user, differentWithdrawType)
      ).rejects.toThrow();
    });

    it('should not allow withdrawal of invalid type', async () => {
      const depositType = Field(4); // Invalid type
      const userNonce = Mina.getAccount(user).nonce;
      const nullifier = Field.random();

      // Attempt to deposit an invalid type
      await expect(deposit(depositType, user)).rejects.toThrow();

      // Attempt to withdraw an invalid type
      await expect(
        withdraw(userNonce, nullifier, user, depositType)
      ).rejects.toThrow();
    });

    it('should not allow withdrawal with invalid nullifier', async () => {
      const depositType = Field(1);
      const { userNonce } = await deposit(depositType, user);
      const nullifier = Field.random();

      // Attempt to withdraw with an invalid nullifier
      await expect(
        withdraw(userNonce, nullifier, user, depositType)
      ).rejects.toThrow();
    });
  });
});
