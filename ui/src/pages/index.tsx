
import Head from 'next/head';
import Image from 'next/image';
import GradientBG from '../components/GradientBG.js';
import styles from '../styles/Home.module.css';

import { useEffect, useState } from "react";

import ZkappWorkerClient from './zkappWorkerClient';
import { PublicKey, Field, UInt32 } from 'snarkyjs';
import { Box, DarkMode, useColorMode, useColorModeValue } from '@chakra-ui/react';

const CONTRACT_ADDRESS = 'B62qjKo8hYqsdjw68hSBB9XaURdNa2JQGi63yLDfVDAx21cnSdEfBeP';
let transactionFee = 0.1;

type DepositNote = {
  depositNonce: UInt32,
  nullifier: Field,
}

export default function Home() {
  let [state, setState] = useState({
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
  });
  let [input, setInput] = useState({
    depositType: 0 | 1 | 2,
    addressToWithdraw: null as null | PublicKey,
    withdrawNote: '',
  });
  let [depositNote, setDepositNote] = useState<null | DepositNote>(null)

  // SETUP
  useEffect(() => {
    (async () => {
      if (!state.hasBeenSetup) {
        const zkappWorkerClient = new ZkappWorkerClient();
        await zkappWorkerClient.setActiveInstanceToBerkeley();

        const mina = (window as any).mina;

        if (mina == null) {
          setState({ ...state, hasWallet: false });
          return;
        }

        const publicKeyBase58: string = (await mina.requestAccounts())[0];
        const publicKey = PublicKey.fromBase58(publicKeyBase58);

        console.log('using key', publicKey.toBase58());

        console.log('checking if account exists...');
        const res = await zkappWorkerClient.fetchAccount({
          publicKey: publicKey!
        });
        const accountExists = res.error == null;

        await zkappWorkerClient.loadContract();

        console.log('compiling zkApp');
        await zkappWorkerClient.compileContract();
        console.log('zkApp compiled');

        const zkappPublicKey = PublicKey.fromBase58(CONTRACT_ADDRESS);

        await zkappWorkerClient.initZkappInstance(zkappPublicKey);

        console.log('getting zkApp state...');
        await zkappWorkerClient.fetchAccount({ publicKey: zkappPublicKey })

        const currentCommitmentsRoot = await zkappWorkerClient.getCommitmentsRoot();
        const currentNullifierHashesRoot = await zkappWorkerClient.getNullifierHashesRoot();
        console.log('current state:', {
          currentCommitmentsRoot: currentCommitmentsRoot.toString(),
          currentNullifierHashesRoot: currentNullifierHashesRoot.toString(),
        });

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
  // Transaction handlersing


  const onSendDepositTransaction = async () => {
    setState({ ...state, creatingDepositTransaction: true });
    console.log("sending a deposit transaction...");

    const caller = await state.zkappWorkerClient!.fetchAccount({
      publicKey: state.publicKey!,
    });

    if (caller.error != null) {
      throw new Error("No account");
    }

    // get caller's information
    const depositNonce = caller.account.nonce;
    const nullifier = Field.random();
    const commitment = Field.random(); // TODO

    // calculate the new commitment. If `addressToWithdraw` is Field(0), then it won't change the hash
    // and the deposit will be withdrawable to any address that got the note
    // const newCommitment = Poseidon.hash(
    //   [
    //     depositNonce.toFields(),
    //     nullifier,
    //     depositType,
    //     addressToWithdraw,
    //   ].flat()
    // );

    // get the witness for the current tree
    // const commitmentWitness = commitmentMap.getWitness(newCommitment);
    const commitmentWitness = Field.random(); // TODO

    // on-chain deposit
    await state.zkappWorkerClient!.createDepositTransaction(
      commitment,
      commitmentWitness,
      Field(input.depositType)
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

    console.log(
      "See transaction at https://berkeley.minaexplorer.com/transaction/" + hash
    );

    // update the leaf locally if the deposit was successful
    // commitmentMap.set(newCommitment, depositType);

    // save necessary information for withdrawal
    setDepositNote({
      depositNonce,
      nullifier,
    })

    setState({ ...state, creatingDepositTransaction: false });
  };

  const onSendWithdrawTransaction = async () => {
    setState({ ...state, creatingWithdrawTransaction: true });
    console.log("sending a withdraw transaction...");

    await state.zkappWorkerClient!.fetchAccount({
      publicKey: state.publicKey!,
    });

    await state.zkappWorkerClient!.createWithdrawTransaction(
      // TODO: get this from the UI
      Field.random(), // nullifier
      Field.random(), // nullifierWitness
      Field.random(), // commitmentWitness
      1,              // nonce
      Field(1),       // depositType
      Field.random()  // specificAddressField
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

    setState({ ...state, creatingWithdrawTransaction: false });
  };

  // -------------------------------------------------------
  // Refresh the current state

  const onRefresh = async () => {
    console.log('getting zkApp state...');
    await state.zkappWorkerClient!.fetchAccount({
      publicKey: state.zkappPublicKey!
    })
    const currentCommitmentsRoot = await state.zkappWorkerClient!.getCommitmentsRoot();
    const currentNullifierHashesRoot = await state.zkappWorkerClient!.getNullifierHashesRoot();

    console.log('current state:', {
      currentCommitmentsRoot: currentCommitmentsRoot.toString(),
      currentNullifierHashesRoot: currentNullifierHashesRoot.toString(),
    });

    setState({ ...state, currentCommitmentsRoot, currentNullifierHashesRoot });
  }

  // -------------------------------------------------------
  // UI

  const bgGradientLight = 'linear(to-t, #fbf1ed, #ffffff)'
  const bgGradientDark = 'linear(to-t, #0f0c17, #0f0c17)'

  let hasWallet;
  if (state.hasWallet != null && !state.hasWallet) {
    const auroLink = 'https://www.aurowallet.com/';
    const auroLinkElem = (
      <a href={auroLink} target="_blank" rel="noreferrer">
        {' '}
        [Link]{' '}
      </a>
    );
    hasWallet = (
      <div>
        {' '}
        Could not find a wallet. Install Auro wallet here: {auroLinkElem}
      </div>
    );
  }

  let setupText = state.hasBeenSetup
    ? 'SnarkyJS Ready'
    : 'Setting up SnarkyJS... (can take up to a minute)';
  let setup = (
    <div>
      {' '}
      {setupText} {hasWallet}
    </div>
  );

  let accountDoesNotExist;
  if (state.hasBeenSetup && !state.accountExists) {
    const faucetLink =
      'https://faucet.minaprotocol.com/?address=' + state.publicKey!.toBase58();
    accountDoesNotExist = (
      <div>
        Account does not exist. Please visit the faucet to fund this account
        <a href={faucetLink} target="_blank" rel="noreferrer">
          {' '}
          [Link]{' '}
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
          <div>Current commitmentsRoot: {state.currentCommitmentsRoot!.toString()}</div>
          <div>Current nullifierHashesRoot: {state.currentNullifierHashesRoot!.toString()}</div>
          <button onClick={onRefresh}>Get Latest State</button>
        </div>

        <div>
          <h2>Deposit</h2>

          <div>
            <input
              type="radio"
              id="depositType1"
              name="depositType"
              value="0"
              checked={input.depositType === 0}
              onChange={(e) => {
                setInput({ ...input, depositType: parseInt(e.target.value) });
              }}
            />
            <label htmlFor="depositType1"> Deposit 1 MINA </label>

            <input
              type="radio"
              id="depositType2"
              name="depositType"
              value="1"
              checked={input.depositType === 1}
              onChange={(e) => {
                setInput({ ...input, depositType: parseInt(e.target.value) });
              }}
            />
            <label htmlFor="depositType2"> Deposit 5 MINA </label>

            <input
              type="radio"
              id="depositType3"
              name="depositType"
              value="2"
              checked={input.depositType === 2}
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
            {' '}
            Deposit Transaction{' '}
          </button>

          {depositNote &&
            <div>
              <h3>Deposit Note</h3>
              <p>Please save this note. You will need it to withdraw your funds.</p>
              <textarea
                value={depositNote.depositNonce.toString().concat(depositNote.nullifier.toString())}
                readOnly={true}
                onClick={(e) => {
                  (e.target as HTMLTextAreaElement).select();
                  document.execCommand('copy');
                }}
              />
            </div>
          }
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
            {' '}
            Withdraw Transaction{' '}
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
      </code>
    </div>
  )

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

  // return (
  //   <>
  //     <Head>
  //       <title>Mina zkApp UI</title>
  //       <meta name="description" content="built with SnarkyJS" />
  //       <link rel="icon" href="/assets/favicon.ico" />
  //     </Head>
  //     <GradientBG>
  //       <main className={styles.main}>
  //         <div className={styles.center}>
  //           <a
  //             href="https://minaprotocol.com/"
  //             target="_blank"
  //             rel="noopener noreferrer"
  //           >
  //             <Image
  //               className={styles.logo}
  //               src="/assets/HeroMinaLogo.svg"
  //               alt="Mina Logo"
  //               width="191"
  //               height="174"
  //               priority
  //             />
  //           </a>
  //           <p className={styles.tagline}>
  //             built with
  //             <code className={styles.code}> SnarkyJS</code>
  //           </p>
  //         </div>
  //         <p className={styles.start}>
  //           Get started by editing
  //           <code className={styles.code}> src/pages/index.tsx</code>
  //         </p>
  //         <div className={styles.grid}>
  //           <a
  //             href="https://docs.minaprotocol.com/zkapps"
  //             className={styles.card}
  //             target="_blank"
  //             rel="noopener noreferrer"
  //           >
  //             <h2>
  //               <span>DOCS</span>
  //               <div>
  //                 <Image
  //                   src="/assets/arrow-right-small.svg"
  //                   alt="Mina Logo"
  //                   width={16}
  //                   height={16}
  //                   priority
  //                 />
  //               </div>
  //             </h2>
  //             <p>Explore zkApps, how to build one, and in-depth references</p>
  //           </a>
  //           <a
  //             href="https://docs.minaprotocol.com/zkapps/tutorials/hello-world"
  //             className={styles.card}
  //             target="_blank"
  //             rel="noopener noreferrer"
  //           >
  //             <h2>
  //               <span>TUTORIALS</span>
  //               <div>
  //                 <Image
  //                   src="/assets/arrow-right-small.svg"
  //                   alt="Mina Logo"
  //                   width={16}
  //                   height={16}
  //                   priority
  //                 />
  //               </div>
  //             </h2>
  //             <p>Learn with step-by-step SnarkyJS tutorials</p>
  //           </a>
  //           <a
  //             href="https://discord.gg/minaprotocol"
  //             className={styles.card}
  //             target="_blank"
  //             rel="noopener noreferrer"
  //           >
  //             <h2>
  //               <span>QUESTIONS</span>
  //               <div>
  //                 <Image
  //                   src="/assets/arrow-right-small.svg"
  //                   alt="Mina Logo"
  //                   width={16}
  //                   height={16}
  //                   priority
  //                 />
  //               </div>
  //             </h2>
  //             <p>Ask questions on our Discord server</p>
  //           </a>
  //           <a
  //             href="https://docs.minaprotocol.com/zkapps/how-to-deploy-a-zkapp"
  //             className={styles.card}
  //             target="_blank"
  //             rel="noopener noreferrer"
  //           >
  //             <h2>
  //               <span>DEPLOY</span>
  //               <div>
  //                 <Image
  //                   src="/assets/arrow-right-small.svg"
  //                   alt="Mina Logo"
  //                   width={16}
  //                   height={16}
  //                   priority
  //                 />
  //               </div>
  //             </h2>
  //             <p>Deploy a zkApp to Berkeley Testnet</p>
  //           </a>
  //         </div>
  //       </main>
  //     </GradientBG>
  //   </>
  // );
}
