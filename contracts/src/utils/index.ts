import {
  Mina,
  PrivateKey,
  AccountUpdate,
  Field,
  Poseidon,
  MerkleMap,
} from 'snarkyjs';
import { ZkMixer } from '../zkMixer';
import { DepositEvent, DepositNote, KeyPair, LocalState } from '../types';

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
 * @param log - a function to log messages
 * @returns {userNonce, nullifier} - the user's nonce and nullifier
 */
async function depositWrapper(
  app: ZkMixer,
  state: LocalState,
  depositType: Field,
  caller: KeyPair,
  addressToWithdraw: Field = Field(0),
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-explicit-any
  log: (...args: any[]) => void = () => {}
): Promise<DepositNote> {
  log(`Deposit of type ${depositType} started`);

  // get caller's information
  const callerAccount = Mina.getAccount(caller.publicKey);
  const depositNonce = callerAccount.nonce;
  const nullifier = Field.random();

  // calculate the new commitment. If `addressToWithdraw` is Field(0), then it won't change the hash
  // and the deposit will be withdrawable to any address that got the note
  const commitment = Poseidon.hash(
    [depositNonce.toFields(), nullifier, depositType, addressToWithdraw].flat()
  );
  log(`Commitment: ${commitment}`);

  // get the witness for the current tree
  const commitmentWitness = state.localCommitmentsMap.getWitness(commitment);

  // on-chain deposit
  const depositTx = await Mina.transaction(caller.publicKey, () => {
    app.deposit(commitment, commitmentWitness, depositType);
  });
  await depositTx.prove();
  await depositTx.sign([caller.privateKey]).send();

  // update the leaf locally if the deposit was successful
  state.localCommitmentsMap.set(commitment, depositType);
  log(`Deposit ${depositNonce} of type ${depositType} was successful`);
  log(`New commitment tree root: ${state.localCommitmentsMap.getRoot()}`);
  log(`Contract commitment tree root: ${app.commitmentsRoot.get().toString()}`);

  // return deposit note for withdrawal
  return {
    nonce: depositNonce,
    commitment,
    nullifier,
    depositType,
    addressToWithdraw: addressToWithdraw,
  };
}

/* withdrawWrapper is a helper function that withdraws from the zkMixer contract
 * @param app - the zkMixer contract
 * @param state - the local state of the contract
 * @param oldNonce - the nonce used when depositing
 * @param nullifier - the nullifier of the note to withdraw
 * @param caller - the caller's public key
 * @param depositType - the type of deposit to make
 * @param addressToWithdraw - the address to withdraw to, if null then it is withdrawable to any address
 * @param log - a function to log messages
 * that got the note
 */
async function withdrawWrapper(
  app: ZkMixer,
  state: LocalState,
  caller: KeyPair,
  note: DepositNote,
  // eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-explicit-any
  log: (...args: any[]) => void = () => {}
) {
  log(`Withdrawal of note ${note.nonce} started`);

  // if `addressToWithdraw` is null, then `addressToWithdrawField` will be Field(0) so it won't change the hash
  let addressToWithdrawField = note?.addressToWithdraw ?? Field(0);
  log(`Address to withdraw: ${addressToWithdrawField}`);

  // calculate the expected commitment used when depositing
  const expectedCommitment = Poseidon.hash(
    [
      note.nonce.toFields(),
      note.nullifier,
      note.depositType,
      addressToWithdrawField,
    ].flat()
  );
  log(`Expected commitment: ${expectedCommitment}`);

  // hash the nullifier
  const nullifierHashed = Poseidon.hash([note.nullifier]);

  // get witnesses for the current tree...
  const commitmentWitness =
    state.localCommitmentsMap.getWitness(expectedCommitment);
  const nullifierWitness =
    state.localNullifierHashedMap.getWitness(nullifierHashed);

  // ... and update the leaf locally
  state.localCommitmentsMap.set(expectedCommitment, note.depositType);

  // get the caller's key (either deployer or user 0 in that file)

  // on-chain withdrawal
  const withdrawTx = await Mina.transaction(caller.publicKey, () => {
    app.withdraw(
      note.nullifier,
      nullifierWitness,
      commitmentWitness,
      note.nonce,
      note.depositType,
      addressToWithdrawField
    );
  });
  await withdrawTx.prove();
  await withdrawTx.sign([caller.privateKey]).send();

  // update the nullifier hash map if the withdrawal was successful
  state.localNullifierHashedMap.set(nullifierHashed, Field(1));
  log(`Withdrawal of note ${note.nonce} was successful`);
  log(`New commitment tree root: ${state.localCommitmentsMap.getRoot()}`);
  log(`Contract commitment tree root: ${app.commitmentsRoot.get().toString()}`);
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
