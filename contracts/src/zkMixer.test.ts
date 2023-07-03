import { ZkMixer } from './zkMixer';
import {
  AccountUpdate,
  Field,
  MerkleMap,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
  UInt64,
} from 'snarkyjs';

let proofsEnabled = false;

const DEPOSIT_AMOUNT = {
  1: 1000000000000,
  2: 5,
  3: 10,
};

describe('ZkMixer', () => {
  let zkMixer: ZkMixer,
    zkMixerPrivateKey: PrivateKey,
    zkMixerPublicKey: PublicKey,
    userCommitments: MerkleMap,
    userNullifierHashes: MerkleMap,
    sender: PublicKey,
    senderKey: PrivateKey,
    Local: any;

  beforeAll(() => {
    if (proofsEnabled) {
      ZkMixer.compile();
    }
  });

  beforeEach(async () => {
    Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    sender = Local.testAccounts[0].publicKey;
    senderKey = Local.testAccounts[0].privateKey;

    zkMixerPrivateKey = PrivateKey.random();
    zkMixerPublicKey = zkMixerPrivateKey.toPublicKey();
    zkMixer = new ZkMixer(zkMixerPublicKey);

    const deployTxn = await Mina.transaction(sender, () => {
      AccountUpdate.fundNewAccount(sender);
      zkMixer.deploy();
    });
    await deployTxn.prove();
    await deployTxn.sign([senderKey, zkMixerPrivateKey]).send();

    userCommitments = new MerkleMap();
    userNullifierHashes = new MerkleMap();

    const initTxn = await Mina.transaction(sender, () => {
      zkMixer.initState(
        userCommitments.getRoot(),
        userNullifierHashes.getRoot()
      );
    });
    await initTxn.prove();
    await initTxn.sign([senderKey]).send();
  });

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

  it.only('should deposit type 1', async () => {
    const user = Local.testAccounts[1].publicKey;
    const userKey = Local.testAccounts[1].privateKey;

    const userAccount = Mina.getAccount(user);
    const userNonce = userAccount.nonce;
    const depositType = Field(1);
    const nullifier = Field.random();
    const commitment = Poseidon.hash(
      [userNonce.toFields(), nullifier, depositType].flat()
    );

    // get initial balances
    const initialUserBalance = Mina.getBalance(user).toBigInt();
    const initialSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

    // get the witness for the current tree
    const witness = userCommitments.getWitness(commitment);
    // update the leaf locally
    userCommitments.set(commitment, depositType);

    const depositTx = await Mina.transaction(user, () => {
      zkMixer.deposit(commitment, witness, depositType);
    });
    await depositTx.prove();
    await depositTx.sign([userKey]).send();

    // get final balances
    const finalUserBalance = Mina.getBalance(user).toBigInt();
    const finalSCBalance = Mina.getBalance(zkMixer.address).toBigInt();

    // compare the root of the smart contract tree to our local tree
    expect(userCommitments.getRoot()).toStrictEqual(
      zkMixer.commitmentsRoot.get()
    );
    expect(finalUserBalance).toEqual(
      initialUserBalance - depositType.toBigInt()
    );
    expect(finalSCBalance).toEqual(initialSCBalance + depositType.toBigInt());
  });
});
