import {
  AccountUpdate,
  Field,
  MerkleMap,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
  isReady,
  shutdown,
} from 'snarkyjs';
import { zkAuthentification } from './zkMixer.js';
await isReady;

console.log('SnarkyJS loaded');

interface User {
  publicKey: PublicKey;
  privateKey: PrivateKey;
  nonce: Field;
  nullifier: Field;
  commitment: Field;
}

let zkApp: zkAuthentification,
  zkAppPrivateKey: PrivateKey,
  zkAppAddress: PublicKey,
  sender: PublicKey,
  senderKey: PrivateKey,
  userMap: MerkleMap;

userMap = new MerkleMap();

const Local = Mina.LocalBlockchain({ proofsEnabled: false });
Mina.setActiveInstance(Local);
sender = Local.testAccounts[0].publicKey;
senderKey = Local.testAccounts[0].privateKey;

function createUser(index: number): User {
  return {
    publicKey: Local.testAccounts[index].publicKey,
    privateKey: Local.testAccounts[index].privateKey,
    nonce: Field(0),
    nullifier: Field(0),
    commitment: Field(0),
  };
}

let alice = createUser(1);
let bob = createUser(2);

// Local.testAccounts[0];
zkAppPrivateKey = PrivateKey.random();
zkAppAddress = zkAppPrivateKey.toPublicKey();
zkApp = new zkAuthentification(zkAppAddress);

const deployTxn = await Mina.transaction(sender, () => {
  AccountUpdate.fundNewAccount(sender);
  zkApp.deploy();
});
await deployTxn.prove();
await deployTxn.sign([senderKey, zkAppPrivateKey]).send();

const initTxn = await Mina.transaction(sender, () => {
  zkApp.initState(userMap.getRoot());
});
await initTxn.prove();
await initTxn.sign([senderKey]).send();

console.log('zkApp deployed and initialized');
const rootAfterDeploy = userMap.getRoot();
console.log('root after deployment', rootAfterDeploy.toString());

async function updateMap(user: User, lastHash: Field = Field(0)) {
  const keyUser = Poseidon.hash(user.publicKey.toFields());
  console.log('keyUser', keyUser.toString());
  const witness = userMap.getWitness(keyUser);
  const depositTxn = await Mina.transaction(user.publicKey, () => {
    zkApp.update(witness, keyUser, lastHash);
  });
  await depositTxn.prove();
  await depositTxn.sign([user.privateKey]).send();

  // compare the root of the smart contract tree to our local tree
  console.log(`local tree root hash after send1: ${userMap.getRoot()}`);
  console.log(`smart contract root hash after send1: ${zkApp.mapRoot.get()}`);
}

await updateMap(alice);
// console.log('hash', hash.toString());

// // hash = await updateMap(alice);
// // console.log('hash', hash.toString());
