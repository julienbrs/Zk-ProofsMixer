
import Head from 'next/head';
import Image from 'next/image';
import GradientBG from '../components/GradientBG.js';
import styles from '../styles/Home.module.css';

import { useEffect, useState } from "react";

import ZkappWorkerClient from './zkappWorkerClient';
import { PublicKey, Field } from 'snarkyjs';

const CONTRACT_ADDRESS = 'TODO';
let transactionFee = 0.1;

export default function Home() {
  let [state, setState] = useState({
    zkappWorkerClient: null as null | ZkappWorkerClient,
    hasWallet: null as null | boolean,
    hasBeenSetup: false,
    accountExists: false,
    publicKey: null as null | PublicKey,
    zkappPublicKey: null as null | PublicKey,
    creatingTransaction: false,
    currentCommitmentsRoot: null as null | Field,
    currentNullifierHashesRoot: null as null | Field,
  });

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
        for (;;) {
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
  // Send a deposit transaction

  const onSendDepositTransaction = async () => {
    setState({ ...state, creatingTransaction: true });
    console.log("sending a deposit transaction...");

    await state.zkappWorkerClient!.fetchAccount({
      publicKey: state.publicKey!,
    });

    await state.zkappWorkerClient!.createDepositTransaction(
      // TODO: get this from the UI
      Field.random(), // commitment
      Field.random(), // witness
      Field(1)        // deposit type
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

    setState({ ...state, creatingTransaction: false });
  };

  const onSendWithdrawTransaction = async () => {
    setState({ ...state, creatingTransaction: true });
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

    setState({ ...state, creatingTransaction: false });
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
    : 'Setting up SnarkyJS...';
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
        <button
          onClick={onSendDepositTransaction}
          disabled={state.creatingTransaction}
        >
          {' '}
          Deposit Transaction (unimplemented, missing args){' '}
        </button>
        <button
          onClick={onSendDepositTransaction}
          disabled={state.creatingTransaction}
        >
          {' '}
          Withdraw Transaction (unimplemented, missing args){' '}
        </button>
        <div> Current commitmentsRoot in zkApp: {state.currentCommitmentsRoot!.toString()} </div>
        <div> Current nullifierHashesRoot in zkApp: {state.currentNullifierHashesRoot!.toString()} </div>
        <button onClick={onRefresh}> Get Latest State</button>
      </div>
    );
  }

  return (
    <div>
      {setup}
      {accountDoesNotExist}
      {mainContent}
    </div>
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
