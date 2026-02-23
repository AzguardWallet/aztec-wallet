import { OperationKind } from "@azguardwallet/types";

export const aztecMethods: OperationKind[] = [
    "aztec_getContractClassMetadata",
    "aztec_getContractMetadata",
    "aztec_getPrivateEvents",
    "aztec_getChainInfo",
    "aztec_registerSender",
    "aztec_getAddressBook",
    "aztec_registerContract",
    "aztec_simulateTx",
    "aztec_simulateUtility",
    "aztec_profileTx",
    "aztec_sendTx",
    "aztec_createAuthWit",
];
