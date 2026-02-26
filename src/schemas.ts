import { Aliased } from "@aztec/aztec.js/wallet";
import { ZodFor } from "@aztec/foundation/schemas";
import { AbiTypeSchema, EventMetadataDefinition, EventSelector } from "@aztec/stdlib/abi";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import z from "zod";

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

export const AccountsSchema: ZodFor<Aliased<AztecAddress>[]> = z.array(
    z.object({
        alias: z.string(),
        item: AztecAddress.schema,
    }),
);
