import { useEffect, useState } from "react";

import ZkappWorkerClient from "./zkappWorkerClient";
import { PublicKey, Field, MerkleMap } from "snarkyjs";
import { useInterval } from 'usehooks-ts'

import { Box, Flex } from "@chakra-ui/react";
import MainCard from "@/components/mainCard";

const CONTRACT_ADDRESS =
  "B62qjDaVbV4tPuB9cn9kBXvrfhaYSvVyMjhZQcuvchRjeuQLWUKJWiR";

export type AppState = {
  zkappWorkerClient: ZkappWorkerClient | null;
  hasWallet: boolean | null;
  hasBeenSetup: boolean;
  accountExists: boolean;
  publicKey: PublicKey | null;
  zkappPublicKey: PublicKey | null;
  creatingDepositTransaction: boolean;
  creatingWithdrawTransaction: boolean;
  currentCommitmentsRoot: Field | null;
  currentNullifierHashesRoot: Field | null;
  localCommitmentsMap: MerkleMap | null;
  localNullifierHashedRoot: MerkleMap | null;
};

export default function Home() {
  const [state, setState] = useState<AppState>({
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

        setStatus("Compiling circuits (up to a min)...");
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
        // if (
        //   !currentCommitmentsRoot.equals(commitmentsTree.getRoot()).toBoolean()
        // ) {
        //   setStatus("Syncing and building commitments merkle tree...");
        //   const events = await zkappWorkerClient.fetchDepositEvents();
        //   commitmentsTree = await buildCommitmentsTreeFromEvents(events);
        // }

        let nullifierHashedTree = new MerkleMap();
        // if (
        //   !currentNullifierHashesRoot
        //     .equals(nullifierHashedTree.getRoot())
        //     .toBoolean()
        // ) {
        //   setStatus("Syncing and building hashed nullifiers merkle tree...");
        //   const events = await zkappWorkerClient.fetchWithdrawEvents();
        //   nullifierHashedTree = await buildNullifierHashedTreeFromEvents(
        //     events
        //   );
        // }

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
  // Refresh the current state

  const onRefresh = async () => {
    if (!state.hasBeenSetup) {
      return;
    }
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

  useInterval(onRefresh, 5000);

  // -------------------------------------------------------
  // UI

  return (
    <Box>
      <Flex
          direction="column"
          align="center"
          justify="center"
          h="100vh"
          bgGradient="linear(to-l, #7928CA, #FF0080)"
      >
          <MainCard state={state} setState={setState} status={status} setStatus={setStatus} />
      </Flex>
    </Box>
  );
}
