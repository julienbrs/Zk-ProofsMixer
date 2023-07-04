import {
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

import { ZkMixer } from './zkMixer.js';

// --------------------------------------
// State and types setup
// --------------------------------------

let zkMixer: ZkMixer,
  zkMixerPrivateKey: PrivateKey,
  zkMixerPublicKey: PublicKey,
  userCommitments: MerkleMap,
  userHashedNullifiers: MerkleMap,
  sender: PublicKey,
  senderKey: PrivateKey;

userCommitments = new MerkleMap();
userHashedNullifiers = new MerkleMap();

interface DepositNote {
  nonce: UInt32;
  commitment: Field;
  nullifier: Field;
  depositType: Field;
}

// --------------------------------------
// Mina blockchain setup
// --------------------------------------

class User {
  publicKey: PublicKey;
  privateKey: PrivateKey;

  constructor(index: number) {
    this.publicKey = Local.testAccounts[index].publicKey;
    this.privateKey = Local.testAccounts[index].privateKey;
  }

  balance(): UInt64 {
    return Mina.getAccount(this.publicKey).balance;
  }
}

const Local = Mina.LocalBlockchain({ proofsEnabled: false });
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

const initTxn = await Mina.transaction(sender, () => {
  zkMixer.initState(userCommitments.getRoot(), userHashedNullifiers.getRoot());
});
await initTxn.prove();
await initTxn.sign([senderKey]).send();

console.log('zkMixer deployed and initialized');

// --------------------------------------
// Helpers for deposit and withdraw
// --------------------------------------

async function deposit(user: User, depositType: Field): Promise<DepositNote> {
  depositType.assertGreaterThanOrEqual(Field(1));
  depositType.assertLessThanOrEqual(Field(3));

  // 1) Generate random nullifier
  const nullifier = Field.random();

  // 2) Generate commitment from nullifier, account nonce and deposit type
  const userAccount = Mina.getAccount(user.publicKey);
  const nonce = userAccount.nonce;
  const commitment = Poseidon.hash(
    [nonce.toFields(), nullifier, depositType].flat()
  );
  const witness = userCommitments.getWitness(commitment);

  // 3) Generate proof and send transaction to Mina
  const depositTx = await Mina.transaction(user.publicKey, () => {
    zkMixer.deposit(commitment, witness, depositType);
  });
  await depositTx.prove();
  await depositTx.sign([user.privateKey]).send();

  // 4) Set commitment and return deposit note
  userCommitments.set(commitment, Field(1));
  return { nonce, commitment, nullifier, depositType } as DepositNote;
}

async function withdraw(
  user: User,
  { nonce, commitment, nullifier, depositType }: DepositNote
) {
  depositType.assertGreaterThanOrEqual(Field(1));
  depositType.assertLessThanOrEqual(Field(3));

  const commitmentWitness = userCommitments.getWitness(commitment);
  const nullifierHash = Poseidon.hash([nullifier]);
  const nullifierHashWitness = userHashedNullifiers.getWitness(nullifierHash);

  const withdrawTx = await Mina.transaction(user.publicKey, () => {
    zkMixer.withdraw(
      nullifier,
      nullifierHashWitness,
      commitmentWitness,
      nonce,
      depositType,
      Field(0)
    );
  });
  await withdrawTx.prove();
  await withdrawTx.sign([user.privateKey]).send();

  userHashedNullifiers.set(nullifierHash, Field(1));
}

// --------------------------------------
// Real scenario with 2 users
// --------------------------------------

let alice = new User(1);
let bob = new User(2);

console.log('Starting scenario with Alice and Bob');
console.log('Alice balance:', alice.balance().toString());
console.log('Bob balance:', bob.balance().toString());
console.log('');

console.log('Alice deposit (type 1)...');
let aliceNote = await deposit(alice, Field(1));
console.log('Alice balance:', alice.balance().toString());
console.log('');

console.log('Bob claim Alice deposit...');
await withdraw(bob, aliceNote);
console.log('Alice balance:', alice.balance().toString());
console.log('Bob balance:', bob.balance().toString());
