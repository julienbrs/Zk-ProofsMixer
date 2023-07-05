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

const DEPOSIT_AMOUNT: Array<bigint> = [
  BigInt(100000),
  BigInt(500000),
  BigInt(1000000),
];

// --------------------------------------
// State and types setup
// --------------------------------------

let zkMixer: ZkMixer,
  zkMixerPrivateKey: PrivateKey,
  zkMixerPublicKey: PublicKey,
  userCommitments: MerkleMap,
  userHashedNullifiers: MerkleMap,
  deployer: PublicKey,
  deployerKey: PrivateKey;

userCommitments = new MerkleMap();
userHashedNullifiers = new MerkleMap();

interface DepositNote {
  nonce: UInt32;
  commitment: Field;
  nullifier: Field;
  depositType: Field;
  addressToWithdrawField: Field;
}

class User {
  publicKey: PublicKey;
  privateKey: PrivateKey;

  constructor(index: number) {
    this.publicKey = Local.testAccounts[index].publicKey;
    this.privateKey = Local.testAccounts[index].privateKey;
  }

  balance(): bigint {
    return Mina.getAccount(this.publicKey).balance.toBigInt();
  }
}

// --------------------------------------
// Mina blockchain setup
// --------------------------------------

const Local = Mina.LocalBlockchain({ proofsEnabled: false });
Mina.setActiveInstance(Local);
deployer = Local.testAccounts[0].publicKey;
deployerKey = Local.testAccounts[0].privateKey;

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
  zkMixer.initState(userCommitments.getRoot(), userHashedNullifiers.getRoot());
});
await initTxn.prove();
await initTxn.sign([deployerKey]).send();

console.log('zkMixer deployed and initialized');

// --------------------------------------
// Helpers for deposit and withdraw
// --------------------------------------

async function depositWrapper(
  depositType: Field,
  caller: User,
  addressToWithdraw: User | null = null
): Promise<DepositNote> {
  // 0) Check deposit type is valid
  depositType.assertGreaterThanOrEqual(Field(1));
  depositType.assertLessThanOrEqual(Field(3));

  // 1) Generate random nullifier
  const nullifier = Field.random();

  // 2) Determine if the user wants to withdraw to a particular address
  let addressToWithdrawField: Field;
  if (addressToWithdraw === null) {
    addressToWithdrawField = Field(0);
  } else {
    addressToWithdrawField = addressToWithdraw.publicKey.toFields()[0];
  }

  // 3) Generate commitment from nullifier, account nonce and deposit type
  const userAccount = Mina.getAccount(caller.publicKey);
  const nonce = userAccount.nonce;
  const commitment = Poseidon.hash(
    [nonce.toFields(), nullifier, depositType, addressToWithdrawField].flat()
  );
  const witness = userCommitments.getWitness(commitment);

  // 4) Generate proof and send transaction to Mina
  const depositTx = await Mina.transaction(caller.publicKey, () => {
    zkMixer.deposit(commitment, witness, depositType);
  });
  await depositTx.prove();
  await depositTx.sign([caller.privateKey]).send();

  // 5) Set commitment and return deposit note
  userCommitments.set(commitment, depositType);
  return {
    nonce,
    commitment,
    nullifier,
    depositType,
    addressToWithdrawField,
  } as DepositNote;
}

async function withdrawWrapper(
  caller: User,
  {
    nonce,
    commitment,
    nullifier,
    depositType,
    addressToWithdrawField,
  }: DepositNote
) {
  // 0) Check deposit type is valid
  depositType.assertGreaterThanOrEqual(Field(1));
  depositType.assertLessThanOrEqual(Field(3));

  // 1) Get witnesses and nullifier hash
  const commitmentWitness = userCommitments.getWitness(commitment);
  const nullifierHash = Poseidon.hash([nullifier]);
  const nullifierHashWitness = userHashedNullifiers.getWitness(nullifierHash);

  // 2) Generate proof and send transaction to Mina
  const withdrawTx = await Mina.transaction(caller.publicKey, () => {
    zkMixer.withdraw(
      nullifier,
      nullifierHashWitness,
      commitmentWitness,
      nonce,
      depositType,
      addressToWithdrawField
    );
  });
  await withdrawTx.prove();
  await withdrawTx.sign([caller.privateKey]).send();

  // 3) Set nullifier hash to spent on local tree
  userHashedNullifiers.set(nullifierHash, Field(1));
  // 4) Set commitment on local tree
  userCommitments.set(commitment, Field(1));
}

// --------------------------------------
// Real use case scenario
// --------------------------------------

let alice = new User(1);
let bob = new User(2);
let oscar = new User(3);
let eve = new User(4);

/* Common usage: Alice deposits, Bob withdraws */

console.log('#**********************#');
console.log('Basic scenario: Alice deposits twice, Bob and Oscar withdraw');
console.log('');

console.log('Alice balance:', alice.balance().toString());
console.log('Bob balance:', bob.balance().toString());
console.log('Oscar balance:', oscar.balance().toString());
console.log('');

console.log(
  'Alice deposit of Type 1 (100000 tokens) and Type 2 (500000 tokens)...'
);
let aliceNote_1 = await depositWrapper(Field(1), alice);
let aliceNote_2 = await depositWrapper(Field(2), alice); // todo: to change to field(2) again, only for debug atm
console.log(
  'Alice balance:',
  alice.balance().toString(),
  `${alice.balance().toString() === '999999400000' ? '✅' : '❌'}`
);
console.log('');

console.log(
  'Bob claims Type 1 (100000 tokens) and Oscar Type 2 (500000 tokens)...'
);
await withdrawWrapper(bob, aliceNote_1);
await withdrawWrapper(oscar, aliceNote_2);
console.log(
  'Bob balance:',
  bob.balance().toString(),
  `${bob.balance().toString() === '1000000100000' ? '✅' : '❌'}`
);
console.log(
  'Oscar balance:',
  oscar.balance().toString(),
  `${oscar.balance().toString() == '1000000500000' ? '✅' : '❌'}`
);

/** However, if Eve is malicious and finds out Alice's note, she can withdraw the funds
 * before Bob and Oscar. To prevent this, Alice can specify an address to withdraw to
 * when she deposits. This address can be Bob's or Oscar's, or even her own.
 */
console.log('#**********************#');
console.log(
  ' Alice deposits and want Bob to withdraw. To prevent Eve from stealing her funds, Alice specifies an address to withdraw to'
);
console.log('');

console.log('Alice initial balance:', alice.balance().toString());
console.log('Bob initial balance:', bob.balance().toString());
console.log('Eve initial balance:', eve.balance().toString());

console.log('Alice deposit of Type 1 (100000 tokens)...');
let aliceNote_3 = await depositWrapper(Field(1), alice, bob);
console.log(
  'Alice balance:',
  alice.balance().toString(),
  `${alice.balance().toString() === '999999400000' ? '✅' : '❌'}`
);

console.log('Eve tries to claim Type 1 (100000 tokens)...');
try {
  await withdrawWrapper(eve, aliceNote_3);
} catch (error) {
  console.log(
    'Error while Eve tries to claim Type 1 (100000 tokens):',
    (error as Error).message.split('\n')[0]
  );
}

console.log('Now Bob tries to claim Type 1 (100000 tokens)...');
await withdrawWrapper(bob, aliceNote_3);

console.log('Alice balance:', alice.balance().toString());
console.log('Bob balance:', bob.balance().toString());
