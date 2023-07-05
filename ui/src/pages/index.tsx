import { useEffect, useState } from "react";

import ZkappWorkerClient from "./zkappWorkerClient";
import { PublicKey, Field, UInt32, MerkleMap, Poseidon } from "snarkyjs";
import { buildCommitmentsTreeFromEvents, buildNullifierHashedTreeFromEvents } from "@contracts/utils";
import { DepositNote } from "@contracts/types";
import { Box, DarkMode, useColorMode, useColorModeValue } from '@chakra-ui/react';

const CONTRACT_ADDRESS =
  "B62qjDaVbV4tPuB9cn9kBXvrfhaYSvVyMjhZQcuvchRjeuQLWUKJWiR";
let transactionFee = 0.1;

export default function Home() {
  const [state, setState] = useState({
    zkappWorkerClient: null as null | ZkappWorkerClient,
    hasWallet: null as null | boolean,
    hasBeenSetup: false,
    accountExists: false,
    publicKey: null as null | PublicKey,
    zkappPublicKey: null as null | PublicKey,
    creatingDepositTransaction: false,
    creatingWithdrawTransaction: false,
    currentCommitmentsRoot: null as null | Field,
    currentNullifierHashesRoot: null as null | Field,
    localCommitmentsMap: null as null | MerkleMap,
    localNullifierHashedRoot: null as null | MerkleMap,
  });
  const [input, setInput] = useState({
    depositType: 1 | 2 | 3,
    addressToWithdraw: null as null | PublicKey,
    withdrawNote: "",
  });
  const [depositNote, setDepositNote] = useState<null | DepositNote>(null);
  const [status, setStatus] = useState("");

  // SETUP
  useEffect(() => {
    (async () => {
      if (!state.hasBeenSetup) {
        setStatus("Loading snarkyjs");
        const zkappWorkerClient = new ZkappWorkerClient();
        await zkappWorkerClient.setActiveInstanceToBerkeley();

        const mina = (window as any).mina;

        if (mina == null) {
          setState({ ...state, hasWallet: false });
          return;
        }

        const publicKeyBase58: string = (await mina.requestAccounts())[0];
        const publicKey = PublicKey.fromBase58(publicKeyBase58);

        setStatus("Getting account...");
        const res = await zkappWorkerClient.fetchAccount({
          publicKey: publicKey!,
        });
        const accountExists = res.error == null;

        await zkappWorkerClient.loadContract();

        setStatus("Compiling zkApp (up to a min)...");
        await zkappWorkerClient.compileContract();

        const zkappPublicKey = PublicKey.fromBase58(CONTRACT_ADDRESS);

        await zkappWorkerClient.initZkappInstance(zkappPublicKey);

        setStatus("Getting latest merkle root...");
        await zkappWorkerClient.fetchAccount({ publicKey: zkappPublicKey });

        const currentCommitmentsRoot =
          await zkappWorkerClient.getCommitmentsRoot();
        const currentNullifierHashesRoot =
          await zkappWorkerClient.getNullifierHashesRoot();

        let commitmentsTree = new MerkleMap();
        if (!currentCommitmentsRoot.equals(commitmentsTree.getRoot()).toBoolean()) {
          setStatus("Syncing and building commitments merkle tree...");
          const events = await zkappWorkerClient.fetchDepositEvents();
          commitmentsTree = await buildCommitmentsTreeFromEvents(events);
        }

        let nullifierHashedTree = new MerkleMap();
        if (!currentNullifierHashesRoot.equals(nullifierHashedTree.getRoot()).toBoolean()) {
          setStatus("Syncing and building hashed nullifiers merkle tree...");
          const events = await zkappWorkerClient.fetchWithdrawEvents();
          nullifierHashedTree = await buildNullifierHashedTreeFromEvents(events);
        }

        setStatus("Done!");
        setState({
          ...state,
          zkappWorkerClient,
          hasWallet: true,
          hasBeenSetup: true,
          publicKey,
          zkappPublicKey,
          accountExists,
          currentCommitmentsRoot,
          currentNullifierHashesRoot,
          localCommitmentsMap: commitmentsTree,
          localNullifierHashedRoot: nullifierHashedTree,
        });
      }
    })();
  }, []);

  // -------------------------------------------------------
  // Wait for account to exist, if it didn't

  useEffect(() => {
    (async () => {
      if (state.hasBeenSetup && !state.accountExists) {
        for (; ;) {
          console.log("checking if account exists...");
          const res = await state.zkappWorkerClient!.fetchAccount({
            publicKey: state.publicKey!,
          });
          const accountExists = res.error == null;
          if (accountExists) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        setState({ ...state, accountExists: true });
      }
    })();
  }, [state.hasBeenSetup]);

  // -------------------------------------------------------
  // Transaction handling

  const onSendDepositTransaction = async () => {
    setState({ ...state, creatingDepositTransaction: true });
    setStatus("Deposit...");

    const depositType = Field(input.depositType);
    const addressToWithdraw = input.addressToWithdraw?.toFields()[0] ?? Field(0);

    const caller = await state.zkappWorkerClient!.fetchAccount({
      publicKey: state.publicKey!,
    });

    if (caller.error != null) {
      throw new Error("No account");
    }

    // get caller's information
    const depositNonce = caller.account.nonce;
    const nullifier = Field.random();

    // calculate the commitment. If `addressToWithdraw` is Field(0), then it won't change the hash
    // and the deposit will be withdrawable to any address that got the note
    const commitment = Poseidon.hash(
      [
        depositNonce.toFields(),
        nullifier,
        depositType,
        addressToWithdraw,
      ].flat()
    );

    // get the witness for the current tree
    const commitmentWitness = state.localCommitmentsMap!.getWitness(commitment);

    // on-chain deposit
    await state.zkappWorkerClient!.createDepositTransaction(
      commitment,
      commitmentWitness,
      depositType
    );

    console.log("creating proof...");
    await state.zkappWorkerClient!.proveCurrentTransaction();

    console.log("getting Transaction JSON...");
    const transactionJSON = await state.zkappWorkerClient!.getTransactionJSON();

    console.log("requesting deposit transaction...");
    const { hash } = await (window as any).mina.sendTransaction({
      transaction: transactionJSON,
      feePayer: {
        fee: transactionFee,
        memo: "",
      },
    });

    setStatus(
      "See transaction at https://berkeley.minaexplorer.com/transaction/" + hash
    );

    // update the leaf locally if the deposit was successful
    state.localCommitmentsMap?.set(commitment, depositType);

    // save necessary information for withdrawal
    setDepositNote({
      nonce: depositNonce,
      commitment,
      nullifier,
      depositType,
      addressToWithdraw 
    });

    setStatus("Done!");
    setState({
      ...state,
      creatingDepositTransaction: false,
    });
  };

  const onSendWithdrawTransaction = async () => {
    setState({ ...state, creatingWithdrawTransaction: true });
    setStatus("Withdraw...");

    const note = parseDepositNote(input.withdrawNote);
    console.log("withdraw note", note);

    const addressToWithdraw = input.addressToWithdraw?.toFields()[0] ?? Field(0);

    await state.zkappWorkerClient!.fetchAccount({
      publicKey: state.publicKey!,
    });

    // calculate the expected commitment used when depositing
    const expectedCommitment = Poseidon.hash(
      [
        note.nonce.toFields(),
        note.nullifier,
        note.depositType,
        addressToWithdraw,
      ].flat()
    );

    // hash the nullifier
    const nullifierHashed = Poseidon.hash([note.nullifier]);

    // get witnesses for the current tree...
    const commitmentWitness = state.localCommitmentsMap!.getWitness(expectedCommitment);
    const nullifierWitness =
      state.localNullifierHashedRoot!.getWitness(nullifierHashed);

    // ... and update the leaf locally
    state.localNullifierHashedRoot!.set(expectedCommitment, note.depositType);

    await state.zkappWorkerClient!.createWithdrawTransaction(
      note.nullifier,
      nullifierWitness,
      commitmentWitness,
      note.nonce,
      note.depositType,
      addressToWithdraw
    );

    console.log("creating proof...");
    await state.zkappWorkerClient!.proveCurrentTransaction();

    console.log("getting Transaction JSON...");
    const transactionJSON = await state.zkappWorkerClient!.getTransactionJSON();

    console.log("requesting withdraw transaction...");
    const { hash } = await (window as any).mina.sendTransaction({
      transaction: transactionJSON,
      feePayer: {
        fee: transactionFee,
        memo: "",
      },
    });

    console.log(
      "See transaction at https://berkeley.minaexplorer.com/transaction/" + hash
    );

    setStatus("Done!");
    setState({ ...state, creatingWithdrawTransaction: false });
  };

  // -------------------------------------------------------
  // Refresh the current state

  const onRefresh = async () => {
    console.log("getting zkApp state...");
    await state.zkappWorkerClient!.fetchAccount({
      publicKey: state.zkappPublicKey!,
    });
    const currentCommitmentsRoot =
      await state.zkappWorkerClient!.getCommitmentsRoot();
    const currentNullifierHashesRoot =
      await state.zkappWorkerClient!.getNullifierHashesRoot();

    console.log("current state:", {
      currentCommitmentsRoot: currentCommitmentsRoot.toString(),
      currentNullifierHashesRoot: currentNullifierHashesRoot.toString(),
    });

    setState({ ...state, currentCommitmentsRoot, currentNullifierHashesRoot });
  };

  // -------------------------------------------------------
  // Deposit note format


  /**
   * Formats a DepositNote object into a deposit note string.
   * The deposit note string will be in the format:
   * <nonce>-<commitment>-<nullifier>-<depositType>-<addressToWithdraw>
   * to base64.
   * 
   * @param note The DepositNote object to format.
   * @returns A deposit note string.
   */
  const formatDepositNote = (note: DepositNote): string => {
    const { nonce, commitment, nullifier, depositType, addressToWithdraw } = note;
    const str = `${nonce.toString()}-${commitment.toString()}-${nullifier.toString()}-${depositType.toString()}-${addressToWithdraw?.toString()}`;
    return btoa(str);
  };

  /**
   * Parses a deposit note string into a DepositNote object.
   * The deposit note string should be in the format:
   * <nonce>-<commitment>-<nullifier>-<depositType>-<addressToWithdraw>
   * from base64.
   * 
   * @param str The deposit note string to parse.
   * @returns A DepositNote object.
   */
  const parseDepositNote = (str: string): DepositNote => {
    const [nonce, commitment, nullifier, depositType, addressToWithdraw] = atob(str).split("-");
    return {
      nonce: new UInt32(parseInt(nonce)),
      commitment: new Field(commitment),
      nullifier: Field(nullifier),
      depositType: Field(depositType),
      addressToWithdraw: Field(addressToWithdraw),
    };
  };

  // -------------------------------------------------------
  // UI

  const bgGradientLight = 'linear(to-t, #fbf1ed, #ffffff)'
  const bgGradientDark = 'linear(to-t, #0f0c17, #0f0c17)'

  let hasWallet;
  if (state.hasWallet != null && !state.hasWallet) {
    const auroLink = "https://www.aurowallet.com/";
    const auroLinkElem = (
      <a href={auroLink} target="_blank" rel="noreferrer">
        {" "}
        [Link]{" "}
      </a>
    );
    hasWallet = (
      <div>
        {" "}
        Could not find a wallet. Install Auro wallet here: {auroLinkElem}
      </div>
    );
  }

  let setupText = state.hasBeenSetup
    ? "SnarkyJS Ready"
    : "Setting up SnarkyJS... (can take up to a minute)";
  let setup = (
    <div>
      {" "}
      {setupText} {hasWallet}
    </div>
  );

  let accountDoesNotExist;
  if (state.hasBeenSetup && !state.accountExists) {
    const faucetLink =
      "https://faucet.minaprotocol.com/?address=" + state.publicKey!.toBase58();
    accountDoesNotExist = (
      <div>
        Account does not exist. Please visit the faucet to fund this account
        <a href={faucetLink} target="_blank" rel="noreferrer">
          {" "}
          [Link]{" "}
        </a>
      </div>
    );
  }

  let mainContent;
  if (state.hasBeenSetup && state.accountExists) {
    mainContent = (
      <div>

        <div>
          <h2>zkApp State</h2>
          <div>
            Current commitmentsRoot: {state.currentCommitmentsRoot!.toString()}
          </div>
          <div>
            Current nullifierHashesRoot:{" "}
            {state.currentNullifierHashesRoot!.toString()}
          </div>
          <button onClick={onRefresh}>Get Latest State</button>
        </div>

        <div>
          <h2>Deposit</h2>

          <div>
            <input
              type="radio"
              id="depositType1"
              name="depositType"
              value="1"
              checked={input.depositType === 1}
              onChange={(e) => {
                setInput({ ...input, depositType: parseInt(e.target.value) });
              }}
            />
            <label htmlFor="depositType1"> Deposit 1 MINA </label>

            <input
              type="radio"
              id="depositType2"
              name="depositType"
              value="2"
              checked={input.depositType === 2}
              onChange={(e) => {
                setInput({ ...input, depositType: parseInt(e.target.value) });
              }}
            />
            <label htmlFor="depositType2"> Deposit 5 MINA </label>

            <input
              type="radio"
              id="depositType3"
              name="depositType"
              value="3"
              checked={input.depositType === 3}
              onChange={(e) => {
                setInput({ ...input, depositType: parseInt(e.target.value) });
              }}
            />
            <label htmlFor="depositType3"> Deposit 10 MINA ?</label>
          </div>

          {/* TODO: custom target address */}

          <button
            onClick={onSendDepositTransaction}
            disabled={state.creatingDepositTransaction}
          >
            {" "}
            Deposit Transaction{" "}
          </button>

          {depositNote && (
            <div>
              <h3>Deposit Note</h3>
              <p>
                Please save this note. You will need it to withdraw your funds.
              </p>
              <textarea
                value={formatDepositNote(depositNote)}
                readOnly={true}
                onClick={(e) => {
                  (e.target as HTMLTextAreaElement).select();
                  document.execCommand("copy");
                }}
              />
            </div>
          )}
        </div>

        <div>
          <h2>Withdraw</h2>

          <input
            type="text"
            placeholder="Deposit Note"
            value={input.withdrawNote}
            onChange={(e) => {
              setInput({ ...input, withdrawNote: e.target.value });
            }}
          />

          <button
            onClick={onSendWithdrawTransaction}
            disabled={state.creatingWithdrawTransaction}
          >
            {" "}
            Withdraw Transaction{" "}
          </button>
        </div>
      </div>
    );
  }

  const debug = (
    <div>
      <h2>Debug</h2>
      <code>
        <span>state:</span>
        <pre>{JSON.stringify(state, null, 2)}</pre>

        <span>input:</span>
        <pre>{JSON.stringify(input, null, 2)}</pre>

        <span>depositNote:</span>
        <pre>{JSON.stringify(depositNote, null, 2)}</pre>

        <span>Status:</span>
        <pre>{JSON.stringify(status, null, 2)}</pre>
      </code>
    </div>
  );

  return (
    <Box bgGradient={bgGradientLight} >
      <div style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', minHeight: '100vh' }}>

          <div>
            {setup}
            {accountDoesNotExist}
            {mainContent}
          </div>

          <div>
            {debug}
          </div>

        </div>
      </div>
    </Box>
  );

}
