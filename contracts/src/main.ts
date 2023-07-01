import { Mina, PrivateKey, Field, AccountUpdate, MerkleMap } from 'snarkyjs';

import { zkAuthentification } from './Authentification.js';

// --------------------------------------
console.log('SnarkyJS loaded');

const useProof = true;

const Local = Mina.LocalBlockchain({ proofsEnabled: useProof });
Mina.setActiveInstance(Local);
const { privateKey: deployerKey, publicKey: deployerAccount } =
  Local.testAccounts[0];

// --------------------------------------

{
  const zkAuthentificationPrivateKey = PrivateKey.random();
  const zkAuthentificationAddress = zkAuthentificationPrivateKey.toPublicKey();

  // initialize the zkapp
  const zkApp = new zkAuthentification(zkAuthentificationAddress);
  await zkAuthentification.compile();

  // create a new map
  const map = new MerkleMap();
  const rootBefore = map.getRoot();
  const key = Field(100);
  const witness = map.getWitness(key);

  // deploy the smart contract
  const deployTxn = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount);

    console.log('Deploying zkAuthentification');
    zkApp.deploy();
    // get the root of the new tree to use as the initial tree root
    zkApp.initAccount(rootBefore);
  });
  await deployTxn.prove();
  await deployTxn.sign([deployerKey, zkAuthentificationPrivateKey]).send();
  console.log('zkAuthentification deployed');

  /**
   * `txn.send()` returns a pending transaction with two methods - `.wait()` and `.hash()`
   * `.hash()` returns the transaction hash
   * `.wait()` automatically resolves once the transaction has been included in a block. this is redundant for the LocalBlockchain, but very helpful for live testnets
   */

  // get the value of the key
  const valueBefore = map.get(key);

  console.log('valueBefore', valueBefore.toString());

  // update the smart contract
  const updateTxn = await Mina.transaction(deployerAccount, () => {
    zkApp.updateAccount(witness, key, Field(50), Field(1));
  });

  await updateTxn.prove();

  await updateTxn.sign([deployerKey, zkAuthentificationPrivateKey]).send();

  // get the new value of the key
  const valueAfter = map.get(key);

  console.log('valueAfter', valueAfter.toString());
}
