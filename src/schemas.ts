import { Aliased } from "@aztec/aztec.js/wallet";
import { ZodFor } from "@aztec/foundation/schemas";
import { AbiTypeSchema, ContractArtifactSchema, EventMetadataDefinition, EventSelector } from "@aztec/stdlib/abi";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import {
    ContractClassWithIdSchema,
    ContractInstanceWithAddressSchema,
    ContractClassMetadata,
    ContractMetadata,
} from "@aztec/stdlib/contract";
import z from "zod";

// copied from aztec.js, because it's not exported

export const ContractClassMetadataSchema: ZodFor<ContractClassMetadata> = z.object({
    contractClass: z.union([ContractClassWithIdSchema, z.undefined()]),
    isContractClassPubliclyRegistered: z.boolean(),
    artifact: z.union([ContractArtifactSchema, z.undefined()]),
});

export const ContractMetadataSchema: ZodFor<ContractMetadata> = z.object({
    contractInstance: z.union([ContractInstanceWithAddressSchema, z.undefined()]),
    isContractInitialized: z.boolean(),
    isContractPublished: z.boolean(),
});

export const EventMetadataDefinitionSchema: ZodFor<EventMetadataDefinition> = z.object({
    eventSelector: EventSelector.schema,
    abiType: AbiTypeSchema,
    fieldNames: z.array(z.string()),
});


export const AddressBookSchema: ZodFor<Aliased<AztecAddress>[]> = z.array(
    z.object({
        alias: z.string(),
        item: AztecAddress.schema,
    }),
);
