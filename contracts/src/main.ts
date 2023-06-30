import {
  Mina,
  isReady,
  shutdown,
  UInt32,
  UInt64,
  Int64,
  Character,
  CircuitString,
  PrivateKey,
  Signature,
  Poseidon,
  Field,
  Circuit,
  MerkleWitness,
  MerkleTree,
  AccountUpdate,
  Struct,
  MerkleMap,
  Bool,
} from 'snarkyjs';

import { zkAuthentification } from './Authentification.js';

await isReady;

// --------------------------------------
console.log('--------------------------------------');

const Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);
const { privateKey: deployerKey, publicKey: deployerAccount } =
  Local.testAccounts[0];
const { privateKey: senderPrivateKey, publicKey: senderPublicKey } =
  Local.testAccounts[1];

// --------------------------------------
// create a new merkle tree and BasicMerkleTreeContract zkapp account

{
  const zkAuthentificationPrivateKey = PrivateKey.random();
  const zkAuthentificationAddress = zkAuthentificationPrivateKey.toPublicKey();

  // initialize the zkapp
  const zkApp = new zkAuthentification(zkAuthentificationAddress);
  await zkAuthentification.compile();

  // create a new tree
  const map = new MerkleMap();
  const rootBefore = map.getRoot();
  const key = Field(0);
  const witness = map.getWitness(key);

  // deploy the smart contract
  const deployTxn = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount);
    zkApp.deploy();
    // get the root of the new tree to use as the initial tree root
    zkApp.initAccount(rootBefore);
  });
  await deployTxn.prove();
  deployTxn.sign([deployerKey, zkAuthentificationPrivateKey]);

  const pendingDeployTx = await deployTxn.send();
  /**
   * `txn.send()` returns a pending transaction with two methods - `.wait()` and `.hash()`
   * `.hash()` returns the transaction hash
   * `.wait()` automatically resolves once the transaction has been included in a block. this is redundant for the LocalBlockchain, but very helpful for live testnets
   */
  await pendingDeployTx.wait();

  // get the value of the key
  const valueBefore = map.get(key);

  console.log('valueBefore', valueBefore.toString());

  // update the smart contract
  const updateTxn = await Mina.transaction(deployerAccount, () => {
    zkApp.updateAccount(witness, key, valueBefore, Field(1));
  });

  await updateTxn.prove();

  updateTxn.sign([deployerKey, zkAuthentificationPrivateKey]);

  const pendingUpdateTx = await updateTxn.send();

  await pendingUpdateTx.wait();

  // get the new value of the key
  const valueAfter = map.get(key);

  console.log('valueAfter', valueAfter.toString());
}
