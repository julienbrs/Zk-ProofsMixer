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

import { ZkMixer } from './zkMixer.js';

// --------------------------------------
// State and types setup
// --------------------------------------

let zkMixer: ZkMixer,
  zkMixerPrivateKey: PrivateKey,
  zkMixerPublicKey: PublicKey,
  sender: PublicKey,
  senderKey: PrivateKey,
  userCommitment: MerkleMap,
  userNullifier: MerkleMap;

userCommitment = new MerkleMap();
userNullifier = new MerkleMap();

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
  zkMixer.initState(userCommitment.getRoot(), userNullifier.getRoot());
});
await initTxn.prove();
await initTxn.sign([senderKey]).send();

console.log('zkMixer deployed and initialized');

// --------------------------------------
// Helpers for deposit and withdraw
// --------------------------------------

async function deposit(user: User, depositType: Field) {
  depositType.assertGreaterThanOrEqual(Field(1));
  depositType.assertLessThanOrEqual(Field(3));

  const userAccount = Mina.getAccount(user.publicKey);
  const nullifier = Field.random();
  const commitment = Poseidon.hash(
    [userAccount.nonce.toFields(), nullifier, depositType].flat()
  );
  const witness = userCommitment.getWitness(commitment);

  const depositTx = await Mina.transaction(user.publicKey, () => {
    zkMixer.deposit(commitment, witness, depositType);
  });
  await depositTx.prove();
  await depositTx.sign([user.privateKey]).send();

  userCommitment.set(commitment, Field(1));
  return { commitment, nullifier, depositType };
}

async function withdraw(
  user: User,
  depositType: Field,
  commitment: Field,
  nullifier: Field
) {
  depositType.assertGreaterThanOrEqual(Field(1));
  depositType.assertLessThanOrEqual(Field(3));

  const userAccount = Mina.getAccount(user.publicKey);
  const commitmentWitness = userCommitment.getWitness(commitment);
  const nullifierHash = Poseidon.hash([nullifier]);
  const nullifierHashWitness = userNullifier.getWitness(nullifierHash);

  const withdrawTx = await Mina.transaction(user.publicKey, () => {
    zkMixer.withdraw(
      nullifier,
      nullifierHashWitness,
      commitmentWitness,
      userAccount.nonce.toFields(),
      depositType
    );
  });
  await withdrawTx.prove();
  await withdrawTx.sign([user.privateKey]).send();

  userNullifier.set(nullifierHash, Field(1));
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
let {
  commitment: aliceCommitment,
  nullifier: aliceNullifier,
  depositType: aliceDepositType,
} = await deposit(alice, Field(1));
console.log('Alice balance:', alice.balance().toString());
console.log('');

console.log('Bob claim Alice deposit...');
await withdraw(bob, aliceDepositType, aliceCommitment, aliceNullifier);
console.log('Alice balance:', alice.balance().toString());
console.log('Bob balance:', bob.balance().toString());
