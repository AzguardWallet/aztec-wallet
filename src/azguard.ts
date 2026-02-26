import { AzguardClient } from "@azguardwallet/client";
import {
    AztecCreateAuthWitOperation,
    AztecGetAccountsOperation,
    AztecGetAddressBookOperation,
    AztecGetChainInfoOperation,
    AztecGetContractClassMetadataOperation,
    AztecGetContractMetadataOperation,
    AztecGetPrivateEventsOperation,
    AztecProfileTxOperation,
    AztecRegisterContractOperation,
    AztecRegisterSenderOperation,
    AztecSendTxOperation,
    AztecSimulateTxOperation,
    AztecSimulateUtilityOperation,
    CaipAccount,
    CaipChain,
    DappMetadata,
    DappPermissions,
    FailedResult,
    Operation,
} from "@azguardwallet/types";
import { CallIntent, IntentInnerHash } from "@aztec/aztec.js/authorization";
import {
    Aliased,
    AppCapabilities,
    BatchableMethods,
    BatchedMethod,
    BatchResults,
    ContractClassMetadata,
    ContractMetadata,
    PrivateEvent,
    PrivateEventFilter,
    ProfileOptions,
    SendOptions,
    SimulateOptions,
    SimulateUtilityOptions,
    WalletCapabilities,
    Wallet,
} from "@aztec/aztec.js/wallet";
import {
    type InteractionWaitOptions,
    type SendReturn,
} from "@aztec/aztec.js/contracts";
import { ChainInfo } from "@aztec/entrypoints/interfaces";
import { Fr } from "@aztec/foundation/curves/bn254";
import { ZodFor } from "@aztec/foundation/schemas";
import { ContractArtifact, EventMetadataDefinition, FunctionCall } from "@aztec/stdlib/abi";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { AuthWitness } from "@aztec/stdlib/auth-witness";
import {
    ContractInstanceWithAddress,
    ContractInstanceWithAddressSchema,
} from "@aztec/stdlib/contract";
import { ExecutionPayload, TxSimulationResult, UtilitySimulationResult, TxHash, TxReceipt, TxProfileResult } from "@aztec/stdlib/tx";
import z from "zod";
import { ChainInfoSchema } from "@aztec/entrypoints/interfaces";
import { ContractClassMetadataSchema, ContractMetadataSchema } from "@aztec/aztec.js/wallet";
import { AddressBookSchema } from "./schemas";
import { aztecMethods } from "./methods";

/** Azguard Wallet client fully compatible with Aztec.js' `Wallet` interface */
export class AztecWallet implements Wallet {
    /**
     * Creates `AztecWallet` instance, connected to Azguard Wallet
     * @param dapp Dapp metadata (default: { name: window.location.hostname })
     * @param chain Chain (default: "devnet")
     * @param timeout Timeout in ms for the `window.azguard` object lookup (default: 1000ms)
     * @returns AztecWallet instance
     */
    public static async connect(dapp?: DappMetadata, chain?: "devnet" | "sandbox" | CaipChain, timeout?: number) {
        if (!dapp?.name) {
            dapp = { ...dapp, name: window.location.hostname };
        }

        if (!chain || chain === "devnet") {
            chain = "aztec:604129785";
        } else if (chain === "sandbox") {
            chain = "aztec:0";
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

    private constructor(azguard: AzguardClient, chain: CaipChain, dapp: DappMetadata) {
        this.#azguard = azguard;
        this.#chain = chain;
        this.#dapp = dapp;
        this.#azguard.onAccountsChanged.addHandler(this.#onAccountsChanged);
        this.#azguard.onPermissionsChanged.addHandler(this.#onPermissionsChanged);
    }

    readonly #onAccountsChanged = () => {
        this.#azguard.disconnect();
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

    async #ensureConnected() {
        if (!this.#azguard.connected) {
            await this.#azguard.connect(this.#dapp, [
                {
                    chains: [this.#chain],
                    methods: aztecMethods,
                },
            ]);
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

    public async getContractClassMetadata(id: Fr): Promise<ContractClassMetadata> {
        return await this.#execute(ContractClassMetadataSchema, {
            kind: "aztec_getContractClassMetadata",
            chain: this.#chain,
            id,
        });
    }

    public async getContractMetadata(address: AztecAddress): Promise<ContractMetadata> {
        return await this.#execute(ContractMetadataSchema, {
            kind: "aztec_getContractMetadata",
            chain: this.#chain,
            address,
        });
    }

    public async getPrivateEvents<T>(
        eventMetadata: EventMetadataDefinition,
        eventFilter: PrivateEventFilter,
    ): Promise<PrivateEvent<T>[]> {
        return await this.#execute(z.any(), {
            kind: "aztec_getPrivateEvents",
            chain: this.#chain,
            eventMetadata,
            eventFilter,
        });
    }

    public async getChainInfo(): Promise<ChainInfo> {
        return await this.#execute(ChainInfoSchema, {
            kind: "aztec_getChainInfo",
            chain: this.#chain,
        });
    }

    public async registerSender(address: AztecAddress, alias?: string): Promise<AztecAddress> {
        return await this.#execute(AztecAddress.schema, {
            kind: "aztec_registerSender",
            chain: this.#chain,
            address,
            alias,
        });
    }

    public async getAddressBook(): Promise<Aliased<AztecAddress>[]> {
        return await this.#execute(AddressBookSchema, {
            kind: "aztec_getAddressBook",
            chain: this.#chain,
        });
    }

    public async getAccounts(): Promise<Aliased<AztecAddress>[]> {
        return await this.#execute(AddressBookSchema, {
            kind: "aztec_getAccounts",
            chain: this.#chain,
        });
    }

    public async registerContract(
        instance: ContractInstanceWithAddress,
        artifact?: ContractArtifact,
        secretKey?: Fr,
    ): Promise<ContractInstanceWithAddress> {
        return await this.#execute(ContractInstanceWithAddressSchema, {
            kind: "aztec_registerContract",
            chain: this.#chain,
            instance,
            artifact,
            secretKey,
        });
    }

    public async simulateTx(exec: ExecutionPayload, opts: SimulateOptions): Promise<TxSimulationResult> {
        await this.#ensureConnected();
        const account = this.#azguard.accounts.find((x) => x.endsWith(opts?.from?.toString()));
        if (!account) {
            throw new Error("Unauthorized 'from' account");
        }
        return await this.#execute(TxSimulationResult.schema, {
            kind: "aztec_simulateTx",
            account,
            exec,
            opts,
        });
    }

    public async simulateUtility(
        call: FunctionCall,
        opts: SimulateUtilityOptions,
    ): Promise<UtilitySimulationResult> {
        return await this.#execute(UtilitySimulationResult.schema, {
            kind: "aztec_simulateUtility",
            account: await this.#account(),
            call,
            opts,
        });
    }

    public async profileTx(exec: ExecutionPayload, opts: ProfileOptions): Promise<TxProfileResult> {
        await this.#ensureConnected();
        const account = this.#azguard.accounts.find((x) => x.endsWith(opts?.from?.toString()));
        if (!account) {
            throw new Error("Unauthorized 'from' account");
        }
        return await this.#execute(TxProfileResult.schema, {
            kind: "aztec_profileTx",
            account,
            exec,
            opts,
        });
    }

    public async sendTx<W extends InteractionWaitOptions = undefined>(
        exec: ExecutionPayload,
        opts: SendOptions<W>,
    ): Promise<SendReturn<W>> {
        await this.#ensureConnected();
        const account = this.#azguard.accounts.find((x) => x.endsWith(opts?.from?.toString()));
        if (!account) {
            throw new Error("Unauthorized 'from' account");
        }
        const schema = z.union([TxHash.schema, TxReceipt.schema]);
        return await this.#execute(schema, {
            kind: "aztec_sendTx",
            account,
            exec,
            opts,
        }) as SendReturn<W>;
    }

    public async createAuthWit(
        from: AztecAddress,
        messageHashOrIntent: IntentInnerHash | CallIntent,
    ): Promise<AuthWitness> {
        await this.#ensureConnected();
        const account = this.#azguard.accounts.find((x) => x.endsWith(from?.toString()));
        if (!account) {
            throw new Error("Unauthorized 'from' account");
        }
        return await this.#execute(AuthWitness.schema, {
            kind: "aztec_createAuthWit",
            account,
            messageHashOrIntent,
        });
    }

    public async requestCapabilities(manifest: AppCapabilities): Promise<WalletCapabilities> {
        // TODO: implement capability negotiation based on manifest
        return {} as WalletCapabilities;
    }

    public async batch<const T extends readonly BatchedMethod[]>(
        methods: T,
    ): Promise<BatchResults<T>> {
        await this.#ensureConnected();

        const operations = [];
        for (const method of methods) {
            switch (method.name) {
                case "registerContract": {
                    const [instance, artifact, secretKey] = method.args as Parameters<BatchableMethods["registerContract"]>;
                    operations.push({
                        kind: "aztec_registerContract",
                        chain: this.#chain,
                        instance,
                        artifact,
                        secretKey,
                    } satisfies AztecRegisterContractOperation);
                    break;
                }
                case "registerSender": {
                    const [address, alias] = method.args as Parameters<BatchableMethods["registerSender"]>;
                    operations.push({
                        kind: "aztec_registerSender",
                        chain: this.#chain,
                        address,
                        alias,
                    } satisfies AztecRegisterSenderOperation);
                    break;
                }
                case "sendTx": {
                    const [exec, opts] = method.args as Parameters<BatchableMethods["sendTx"]>;
                    const account = this.#azguard.accounts.find((x) =>
                        x.endsWith(opts?.from?.toString()),
                    );
                    if (!account) {
                        throw new Error("Unauthorized 'from' account");
                    }
                    operations.push({
                        kind: "aztec_sendTx",
                        account,
                        exec,
                        opts,
                    } satisfies AztecSendTxOperation);
                    break;
                }
                case "simulateTx": {
                    const [exec, opts] = method.args as Parameters<BatchableMethods["simulateTx"]>;
                    const account = this.#azguard.accounts.find((x) =>
                        x.endsWith(opts?.from?.toString()),
                    );
                    if (!account) {
                        throw new Error("Unauthorized 'from' account");
                    }
                    operations.push({
                        kind: "aztec_simulateTx",
                        account,
                        exec,
                        opts,
                    } satisfies AztecSimulateTxOperation);
                    break;
                }
                case "simulateUtility": {
                    const [call, opts] = method.args as Parameters<BatchableMethods["simulateUtility"]>;
                    operations.push({
                        kind: "aztec_simulateUtility",
                        account: await this.#account(),
                        call,
                        opts,
                    } satisfies AztecSimulateUtilityOperation);
                    break;
                }
                case "getChainInfo": {
                    operations.push({
                        kind: "aztec_getChainInfo",
                        chain: this.#chain,
                    } satisfies AztecGetChainInfoOperation);
                    break;
                }
                case "getContractMetadata": {
                    const [address] = method.args as Parameters<BatchableMethods["getContractMetadata"]>;
                    operations.push({
                        kind: "aztec_getContractMetadata",
                        chain: this.#chain,
                        address,
                    } satisfies AztecGetContractMetadataOperation);
                    break;
                }
                case "getContractClassMetadata": {
                    const [id] = method.args as Parameters<BatchableMethods["getContractClassMetadata"]>;
                    operations.push({
                        kind: "aztec_getContractClassMetadata",
                        chain: this.#chain,
                        id,
                    } satisfies AztecGetContractClassMetadataOperation);
                    break;
                }
                case "getAddressBook": {
                    operations.push({
                        kind: "aztec_getAddressBook",
                        chain: this.#chain,
                    } satisfies AztecGetAddressBookOperation);
                    break;
                }
                case "getAccounts": {
                    operations.push({
                        kind: "aztec_getAccounts",
                        chain: this.#chain,
                    } satisfies AztecGetAccountsOperation);
                    break;
                }
                case "getPrivateEvents": {
                    const [eventMetadata, eventFilter] = method.args as Parameters<BatchableMethods["getPrivateEvents"]>;
                    operations.push({
                        kind: "aztec_getPrivateEvents",
                        chain: this.#chain,
                        eventMetadata,
                        eventFilter,
                    } satisfies AztecGetPrivateEventsOperation);
                    break;
                }
                case "profileTx": {
                    const [exec, opts] = method.args as Parameters<BatchableMethods["profileTx"]>;
                    const account = this.#azguard.accounts.find((x) =>
                        x.endsWith(opts?.from?.toString()),
                    );
                    if (!account) {
                        throw new Error("Unauthorized 'from' account");
                    }
                    operations.push({
                        kind: "aztec_profileTx",
                        account,
                        exec,
                        opts,
                    } satisfies AztecProfileTxOperation);
                    break;
                }
                case "createAuthWit": {
                    const [from, messageHashOrIntent] = method.args as Parameters<BatchableMethods["createAuthWit"]>;
                    const account = this.#azguard.accounts.find((x) =>
                        x.endsWith(from?.toString()),
                    );
                    if (!account) {
                        throw new Error("Unauthorized 'from' account");
                    }
                    operations.push({
                        kind: "aztec_createAuthWit",
                        account,
                        messageHashOrIntent,
                    } satisfies AztecCreateAuthWitOperation);
                    break;
                }
                case "requestCapabilities":
                default: {
                    throw new Error("Unsupported batch method");
                }
            }
        }

        const results = await this.#azguard.execute(operations);

        const output = [];
        for (let i = 0; i < results.length; i++) {
            const method = methods[i].name;
            const result = results[i];
            if (result.status === "failed") {
                throw new Error(`${method} failed with '${result.error}'`);
            }
            if (result.status === "skipped") {
                throw new Error(`${method} was skipped`);
            }
            switch (method) {
                case "registerContract": {
                    output.push({
                        name: method,
                        result: await ContractInstanceWithAddressSchema.parseAsync(result.result),
                    });
                    break;
                }
                case "registerSender": {
                    output.push({
                        name: method,
                        result: await AztecAddress.schema.parseAsync(result.result),
                    });
                    break;
                }
                case "sendTx": {
                    output.push({
                        name: method,
                        result: await z.union([TxHash.schema, TxReceipt.schema]).parseAsync(result.result),
                    });
                    break;
                }
                case "simulateTx": {
                    output.push({
                        name: method,
                        result: await TxSimulationResult.schema.parseAsync(result.result),
                    });
                    break;
                }
                case "simulateUtility": {
                    output.push({
                        name: method,
                        result: await UtilitySimulationResult.schema.parseAsync(result.result),
                    });
                    break;
                }
                case "getChainInfo": {
                    output.push({
                        name: method,
                        result: await ChainInfoSchema.parseAsync(result.result),
                    });
                    break;
                }
                case "getContractMetadata": {
                    output.push({
                        name: method,
                        result: await ContractMetadataSchema.parseAsync(result.result),
                    });
                    break;
                }
                case "getContractClassMetadata": {
                    output.push({
                        name: method,
                        result: await ContractClassMetadataSchema.parseAsync(result.result),
                    });
                    break;
                }
                case "getAddressBook": {
                    output.push({
                        name: method,
                        result: await AddressBookSchema.parseAsync(result.result),
                    });
                    break;
                }
                case "getAccounts": {
                    output.push({
                        name: method,
                        result: await AddressBookSchema.parseAsync(result.result),
                    });
                    break;
                }
                case "getPrivateEvents": {
                    output.push({
                        name: method,
                        result: await z.any().parseAsync(result.result),
                    });
                    break;
                }
                case "profileTx": {
                    output.push({
                        name: method,
                        result: await TxProfileResult.schema.parseAsync(result.result),
                    });
                    break;
                }
                case "createAuthWit": {
                    output.push({
                        name: method,
                        result: await AuthWitness.schema.parseAsync(result.result),
                    });
                    break;
                }
                case "requestCapabilities":
                default: {
                    throw new Error("Unsupported batch method");
                }
            }
        }

        return output as BatchResults<T>;
    }
}
