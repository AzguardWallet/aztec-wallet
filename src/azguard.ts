import { AzguardClient } from "@azguardwallet/client";
import {
    CaipAccount,
    CaipChain,
    DappMetadata,
    DappPermissions,
    FailedResult,
    FeePaymentMethodDto,
    IntentActionDto,
    IntentInnerHashDto,
    Operation,
} from "@azguardwallet/types";
import {
    AuthWitness,
    AztecAddress,
    CompleteAddress,
    ContractArtifact,
    ContractFunctionInteraction,
    ContractInstanceWithAddress,
    Fr,
    IntentAction,
    IntentInnerHash,
    NodeInfo,
    Tx,
    TxExecutionRequest,
    TxHash,
    TxProfileResult,
    TxReceipt,
    Wallet,
} from "@aztec/aztec.js";
import { FeeOptions, TxExecutionOptions } from "@aztec/entrypoints/interfaces";
import { ExecutionPayload } from "@aztec/entrypoints/payload";
import { ZodFor } from "@aztec/foundation/schemas";
import { GasFees } from "@aztec/stdlib/gas";
import {
    ContractClassMetadata,
    ContractMetadata,
    PXEInfo,
    EventMetadataDefinition,
} from "@aztec/stdlib/interfaces/client";
import {
    SimulationOverrides,
    TxSimulationResult,
    UtilitySimulationResult,
    PrivateExecutionResult,
    TxProvingResult,
} from "@aztec/stdlib/tx";
import { NodeInfoSchema } from "@aztec/stdlib/contract";
import z from "zod";
import { ContractClassMetadataSchema, ContractMetadataSchema, PXEInfoSchema } from "./schemas";
import { aztecMethods } from "./methods";

/** Azguard Wallet client fully compatible with Aztec.js' `Wallet` interface */
export class AztecWallet implements Wallet {
    /**
     * Creates `AztecWallet` instance, connected to Azguard Wallet
     * @param dapp Dapp metadata (default: { name: window.location.hostname })
     * @param chain Chain (default: "testnet")
     * @param timeout Timeout in ms for the `window.azguard` object lookup (default: 1000ms)
     * @returns AztecWallet instance
     */
    public static async connect(dapp?: DappMetadata, chain?: "testnet" | "sandbox" | CaipChain, timeout?: number) {
        if (!dapp?.name) {
            dapp = { ...dapp, name: window.location.hostname };
        }

        if (!chain || chain === "testnet") {
            chain = "aztec:11155111";
        } else if (chain === "sandbox") {
            chain = "aztec:31337";
        }

        const azguard = await AzguardClient.create("aztec.js", timeout ?? 1000);

        const wallet = new AztecWallet(azguard, chain, dapp);
        await wallet.connect();

        return wallet;
    }

    /** Indicates whether the wallet is connected or not */
    public get connected() {
        return this.#azguard.connected;
    }

    /** Event handlers invoked when the wallet is connected */
    public get onConnected() {
        return this.#azguard.onConnected;
    }

    /** Event handlers invoked when the wallet is disconnected */
    public get onDisconnected() {
        return this.#azguard.onDisconnected;
    }

    /** Connects to the wallet */
    public async connect() {
        await this.#ensureConnected();
    }

    /** Disconnects from the wallet */
    public async disconnect() {
        await this.#azguard.disconnect();
    }

    #azguard: AzguardClient;
    #chain: CaipChain;
    #dapp: DappMetadata;

    #completeAddress?: CompleteAddress;
    #address?: AztecAddress;
    #chainId?: Fr;
    #version?: Fr;

    private constructor(azguard: AzguardClient, chain: CaipChain, dapp: DappMetadata) {
        this.#azguard = azguard;
        this.#chain = chain;
        this.#dapp = dapp;
        this.#azguard.onAccountsChanged.addHandler(this.#onAccountsChanged);
        this.#azguard.onPermissionsChanged.addHandler(this.#onPermissionsChanged);
        this.#azguard.onDisconnected.addHandler(this.#onDisconnected);
    }

    readonly #onAccountsChanged = (accounts: CaipAccount[]) => {
        const currentAccount = this.#address?.toString();
        if (currentAccount && !accounts.some((x) => x.endsWith(currentAccount))) {
            this.#azguard.disconnect();
        }
    };

    readonly #onPermissionsChanged = (permissions: DappPermissions[]) => {
        if (
            aztecMethods.some(
                (x) => !permissions.some((p) => p.chains?.includes(this.#chain) && p.methods?.includes(x)),
            )
        ) {
            this.#azguard.disconnect();
        }
    };

    readonly #onDisconnected = () => {
        this.#completeAddress = undefined;
        this.#address = undefined;
        this.#chainId = undefined;
        this.#version = undefined;
    };

    async #ensureConnected() {
        if (!this.#azguard.connected) {
            await this.#azguard.connect(this.#dapp, [
                {
                    chains: [this.#chain],
                    methods: aztecMethods,
                },
            ]);
        }

        if (!this.#version) {
            const [r1, r2, r3, r4] = await this.#azguard.execute([
                {
                    kind: "aztec_getCompleteAddress",
                    account: this.#azguard.accounts[0],
                },
                {
                    kind: "aztec_getAddress",
                    account: this.#azguard.accounts[0],
                },
                {
                    kind: "aztec_getChainId",
                    chain: this.#chain,
                },
                {
                    kind: "aztec_getVersion",
                    chain: this.#chain,
                },
            ]);

            if (r1.status !== "ok" || r2.status !== "ok" || r3.status !== "ok" || r4.status !== "ok") {
                throw new Error("Failed to initialize aztec wallet");
            }

            this.#completeAddress = await CompleteAddress.schema.parseAsync(r1.result);
            this.#address = await AztecAddress.schema.parseAsync(r2.result);
            this.#chainId = await Fr.schema.parseAsync(r3.result);
            this.#version = await Fr.schema.parseAsync(r4.result);
        }
    }

    async #account(): Promise<CaipAccount> {
        await this.#ensureConnected();
        return this.#azguard.accounts[0];
    }

    async #execute<T>(schema: ZodFor<T>, operation: Operation): Promise<T> {
        await this.#ensureConnected();
        const [result] = await this.#azguard.execute([operation]);
        if (result.status === "failed") {
            throw new Error(`Operation failed: ${(result as FailedResult).error}`);
        }
        if (result.status === "skipped") {
            throw new Error("Operation was skipped");
        }
        return await schema.parseAsync(result.result);
    }

    public getCompleteAddress(): CompleteAddress {
        if (!this.#completeAddress) {
            throw new Error("Aztec wallet was disconnected by the user");
        }
        return this.#completeAddress;
    }

    public getAddress(): AztecAddress {
        if (!this.#address) {
            throw new Error("Aztec wallet was disconnected by the user");
        }
        return this.#address;
    }

    public getChainId(): Fr {
        if (!this.#chainId) {
            throw new Error("Aztec wallet was disconnected by the user");
        }
        return this.#chainId;
    }

    public getVersion(): Fr {
        if (!this.#version) {
            throw new Error("Aztec wallet was disconnected by the user");
        }
        return this.#version;
    }

    public async createTxExecutionRequest(
        exec: ExecutionPayload,
        fee: FeeOptions,
        options: TxExecutionOptions,
    ): Promise<TxExecutionRequest> {
        let asset: AztecAddress | undefined;
        try {
            asset = await fee.paymentMethod.getAsset();
        } catch {}
        const paymentMethodDto: FeePaymentMethodDto = {
            asset,
            executionPayload: await fee.paymentMethod.getExecutionPayload(fee.gasSettings),
            feePayer: await fee.paymentMethod.getFeePayer(fee.gasSettings),
        };
        return await this.#execute(TxExecutionRequest.schema, {
            kind: "aztec_createTxExecutionRequest",
            account: await this.#account(),
            exec,
            fee: {
                paymentMethod: paymentMethodDto,
                gasSettings: fee.gasSettings,
            },
            options,
        });
    }

    public async createAuthWit(
        messageHashOrIntent: IntentAction | IntentInnerHash | Fr | Buffer,
    ): Promise<AuthWitness> {
        let intentDto: IntentActionDto | IntentInnerHashDto | Fr;
        if (typeof messageHashOrIntent === "object" && "caller" in messageHashOrIntent) {
            intentDto = {
                caller: messageHashOrIntent.caller,
                action:
                    messageHashOrIntent.action instanceof ContractFunctionInteraction
                        ? (await messageHashOrIntent.action.request()).calls[0]
                        : messageHashOrIntent.action,
            };
        } else if (typeof messageHashOrIntent === "object" && "consumer" in messageHashOrIntent) {
            intentDto = {
                consumer: messageHashOrIntent.consumer,
                innerHash: new Fr(messageHashOrIntent.innerHash),
            };
        } else {
            intentDto = new Fr(messageHashOrIntent);
        }
        return await this.#execute(AuthWitness.schema, {
            kind: "aztec_createAuthWit",
            account: await this.#account(),
            messageHashOrIntent: intentDto,
        });
    }

    public async simulateTx(
        txRequest: TxExecutionRequest,
        simulatePublic: boolean,
        skipTxValidation?: boolean,
        skipFeeEnforcement?: boolean,
        overrides?: SimulationOverrides,
        scopes?: AztecAddress[],
    ): Promise<TxSimulationResult> {
        return await this.#execute(TxSimulationResult.schema, {
            kind: "aztec_simulateTx",
            chain: this.#chain,
            txRequest,
            simulatePublic,
            skipTxValidation,
            skipFeeEnforcement,
            overrides,
            scopes,
        });
    }

    public async simulateUtility(
        functionName: string,
        args: any[],
        to: AztecAddress,
        authwits?: AuthWitness[],
        from?: AztecAddress,
        scopes?: AztecAddress[],
    ): Promise<UtilitySimulationResult> {
        return await this.#execute(UtilitySimulationResult.schema, {
            kind: "aztec_simulateUtility",
            chain: this.#chain,
            functionName,
            args,
            to,
            authwits,
            from,
            scopes,
        });
    }

    public async profileTx(
        txRequest: TxExecutionRequest,
        profileMode: "gates" | "execution-steps" | "full",
        skipProofGeneration?: boolean,
        msgSender?: AztecAddress,
    ): Promise<TxProfileResult> {
        return await this.#execute(TxProfileResult.schema, {
            kind: "aztec_profileTx",
            chain: this.#chain,
            txRequest,
            profileMode,
            skipProofGeneration,
            msgSender,
        });
    }

    public async sendTx(tx: Tx): Promise<TxHash> {
        return await this.#execute(TxHash.schema, {
            kind: "aztec_sendTx",
            chain: this.#chain,
            tx,
        });
    }

    public async getContractClassMetadata(id: Fr, includeArtifact?: boolean): Promise<ContractClassMetadata> {
        return await this.#execute(ContractClassMetadataSchema, {
            kind: "aztec_getContractClassMetadata",
            chain: this.#chain,
            id,
            includeArtifact,
        });
    }

    public async getContractMetadata(address: AztecAddress): Promise<ContractMetadata> {
        return await this.#execute(ContractMetadataSchema, {
            kind: "aztec_getContractMetadata",
            chain: this.#chain,
            address,
        });
    }

    public async registerContract(contract: {
        instance: ContractInstanceWithAddress;
        artifact?: ContractArtifact;
    }): Promise<void> {
        return await this.#execute(z.void(), {
            kind: "aztec_registerContract",
            chain: this.#chain,
            contract,
        });
    }

    public async registerContractClass(artifact: ContractArtifact): Promise<void> {
        return await this.#execute(z.void(), {
            kind: "aztec_registerContractClass",
            chain: this.#chain,
            artifact,
        });
    }

    public async proveTx(
        txRequest: TxExecutionRequest,
        privateExecutionResult?: PrivateExecutionResult,
    ): Promise<TxProvingResult> {
        return await this.#execute(TxProvingResult.schema, {
            kind: "aztec_proveTx",
            chain: this.#chain,
            txRequest,
            privateExecutionResult,
        });
    }

    public async getNodeInfo(): Promise<NodeInfo> {
        return await this.#execute(NodeInfoSchema, {
            kind: "aztec_getNodeInfo",
            chain: this.#chain,
        });
    }

    public async getPXEInfo(): Promise<PXEInfo> {
        return await this.#execute(PXEInfoSchema, {
            kind: "aztec_getPXEInfo",
            chain: this.#chain,
        });
    }

    public async getCurrentBaseFees(): Promise<GasFees> {
        return await this.#execute(GasFees.schema, {
            kind: "aztec_getCurrentBaseFees",
            chain: this.#chain,
        });
    }

    public async updateContract(contractAddress: AztecAddress, artifact: ContractArtifact): Promise<void> {
        return await this.#execute(z.void(), {
            kind: "aztec_updateContract",
            chain: this.#chain,
            contractAddress,
            artifact,
        });
    }

    public async registerSender(address: AztecAddress): Promise<AztecAddress> {
        return await this.#execute(AztecAddress.schema, {
            kind: "aztec_registerSender",
            chain: this.#chain,
            address,
        });
    }

    public async getSenders(): Promise<AztecAddress[]> {
        return await this.#execute(z.array(AztecAddress.schema), {
            kind: "aztec_getSenders",
            chain: this.#chain,
        });
    }

    public async removeSender(address: AztecAddress): Promise<void> {
        return await this.#execute(z.void(), {
            kind: "aztec_removeSender",
            chain: this.#chain,
            address,
        });
    }

    public async getTxReceipt(txHash: TxHash): Promise<TxReceipt> {
        return await this.#execute(TxReceipt.schema, {
            kind: "aztec_getTxReceipt",
            chain: this.#chain,
            txHash,
        });
    }

    public async getPrivateEvents<T>(
        contractAddress: AztecAddress,
        eventMetadata: EventMetadataDefinition,
        from: number,
        numBlocks: number,
        recipients: AztecAddress[],
    ): Promise<T[]> {
        return await this.#execute(z.any(), {
            kind: "aztec_getPrivateEvents",
            chain: this.#chain,
            contractAddress,
            eventMetadata,
            from,
            numBlocks,
            recipients,
        });
    }

    public async getPublicEvents<T>(eventMetadata: EventMetadataDefinition, from: number, limit: number): Promise<T[]> {
        return await this.#execute(z.any(), {
            kind: "aztec_getPublicEvents",
            chain: this.#chain,
            eventMetadata,
            from,
            limit,
        });
    }
}
