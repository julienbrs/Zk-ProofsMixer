import {
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Field,
  Poseidon,
  UInt32,
  MerkleMap,
} from 'snarkyjs';
import { ZkMixer } from '../zkMixer';
import { DepositEvent, KeyPair, LocalState } from '../types';

/**
 * Deploys and initializes the zkMixer contract
 * @param app - the zkMixer contract
 * @param privateKey - the private key of the contract owner
 * @param deployer - the deployer's keys
 */
const deployAndInit = async (
  app: ZkMixer,
  privateKey: PrivateKey,
  deployer: KeyPair
) => {
  const deployTxn = await Mina.transaction(deployer.publicKey, () => {
    AccountUpdate.fundNewAccount(deployer.publicKey);
    app.deploy();
  });
  await deployTxn.prove();
  await deployTxn.sign([deployer.privateKey, privateKey]).send();

  const initTxn = await Mina.transaction(deployer.publicKey, () => {
    app.initState();
  });
  await initTxn.prove();
  await initTxn.sign([deployer.privateKey]).send();
};

/* depositWrapper is a helper function that deposits to the zkMixer contract and returns the user's nonce and nullifier
 * @param app - the zkMixer contract
 * @param state - the local state of the contract
 * @param depositType - the type of deposit to make
 * @param caller - the caller's keys
 * @param addressToWithdraw - the address to withdraw to, if null then it is withdrawable to any address
 * that got the note
 * @returns {userNonce, nullifier} - the user's nonce and nullifier
 */
async function depositWrapper(
  app: ZkMixer,
  state: LocalState,
  depositType: Field,
  caller: KeyPair,
  addressToWithdraw: Field = Field(0)
) {
  // get caller's information
  const callerAccount = Mina.getAccount(caller.publicKey);
  const depositNonce = callerAccount.nonce;
  const nullifier = Field.random();

  // calculate the new commitment. If `addressToWithdraw` is Field(0), then it won't change the hash
  // and the deposit will be withdrawable to any address that got the note
  const newCommitment = Poseidon.hash(
    [depositNonce.toFields(), nullifier, depositType, addressToWithdraw].flat()
  );

  // get the witness for the current tree
  const commitmentWitness = state.localCommitmentsMap.getWitness(newCommitment);

  // on-chain deposit
  const depositTx = await Mina.transaction(caller.publicKey, () => {
    app.deposit(newCommitment, commitmentWitness, depositType);
  });
  await depositTx.prove();
  await depositTx.sign([caller.privateKey]).send();

  // update the leaf locally if the deposit was successful
  state.localCommitmentsMap.set(newCommitment, depositType);

  // return necessary information for withdrawal
  return { depositNonce, nullifier };
}

/* withdrawWrapper is a helper function that withdraws from the zkMixer contract
 * @param app - the zkMixer contract
 * @param state - the local state of the contract
 * @param oldNonce - the nonce used when depositing
 * @param nullifier - the nullifier of the note to withdraw
 * @param caller - the caller's public key
 * @param depositType - the type of deposit to make
 * @param addressToWithdraw - the address to withdraw to, if null then it is withdrawable to any address
 * that got the note
 */
async function withdrawWrapper(
  app: ZkMixer,
  state: LocalState,
  oldNonce: UInt32,
  nullifier: Field,
  caller: KeyPair,
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
  const commitmentWitness =
    state.localCommitmentsMap.getWitness(expectedCommitment);
  const nullifierWitness =
    state.localNullifierHashedMap.getWitness(nullifierHashed);
  // ... and update the leaf locally
  state.localCommitmentsMap.set(expectedCommitment, Field(1));

  // get the caller's key (either deployer or user 0 in that file)

  // on-chain withdrawal
  const withdrawTx = await Mina.transaction(caller.publicKey, () => {
    app.withdraw(
      nullifier,
      nullifierWitness,
      commitmentWitness,
      oldNonce,
      depositType,
      addressToWithdrawField
    );
  });
  await withdrawTx.prove();
  await withdrawTx.sign([caller.privateKey]).send();

  // update the nullifier hash map if the withdrawal was successful
  state.localNullifierHashedMap.set(nullifierHashed, Field(1));
}

/**
 * Fetches the latest Merkle tree from the zkMixer contract
 * @param app - the zkMixer contract
 * @returns the latest Merkle tree as a MerkleMap object
 */
const fetchLatestTree = async (app: ZkMixer): Promise<MerkleMap> => {
  const tree = new MerkleMap();
  (await app.fetchEvents())
    .filter((e) => e.type === 'set')
    .forEach((e) => {
      const event = e.event.data as unknown as DepositEvent;
      tree.set(event.commitment, event.depositType);
    });
  return tree;
};

export { deployAndInit, depositWrapper, withdrawWrapper, fetchLatestTree };
