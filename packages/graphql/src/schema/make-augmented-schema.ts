import { mergeTypeDefs } from "@graphql-tools/merge";
import { ObjectTypeDefinitionNode } from "graphql";
import { SchemaComposer, ObjectTypeComposerFieldConfigAsObjectDefinition, InputTypeComposer } from "graphql-compose";
import { makeExecutableSchema } from "@graphql-tools/schema";
import pluralize from "pluralize";
import { Auth, NeoSchema, NeoSchemaConstructor, Node } from "../classes";
import getFieldTypeMeta from "./get-field-type-meta";
import getCypherMeta from "./get-cypher-meta";
import getAuth from "./get-auth";
import getRelationshipMeta from "./get-relationship-meta";
import { RelationField, CypherField, PrimitiveField, BaseField } from "../types";
import { upperFirstLetter } from "../utils";
import findResolver from "./find";
import createResolver from "./create";
import deleteResolver from "./delete";
import updateResolver from "./update";

export interface MakeAugmentedSchemaOptions {
    typeDefs: any;
    debug?: boolean | ((...values: any[]) => void);
}

function makeAugmentedSchema(options: MakeAugmentedSchemaOptions): NeoSchema {
    const document = mergeTypeDefs(Array.isArray(options.typeDefs) ? options.typeDefs : [options.typeDefs]);
    const composer = new SchemaComposer();
    let neoSchema: NeoSchema;
    // @ts-ignore
    const neoSchemaInput: NeoSchemaConstructor = {
        options,
    };

    composer.createObjectTC({
        name: "DeleteInfo",
        fields: {
            nodesDeleted: "Int!",
            relationshipsDeleted: "Int!",
        },
    });

    neoSchemaInput.nodes = (document.definitions.filter(
        (x) => x.kind === "ObjectTypeDefinition" && !["Query", "Mutation", "Subscription"].includes(x.name.value)
    ) as ObjectTypeDefinitionNode[]).map((definition) => {
        const authDirective = definition.directives?.find((x) => x.name.value === "auth");
        let auth: Auth;
        if (authDirective) {
            auth = getAuth(authDirective);
        }

        const { relationFields, primitiveFields, cypherFields } = definition?.fields?.reduce(
            (
                res: {
                    relationFields: RelationField[];
                    primitiveFields: PrimitiveField[];
                    cypherFields: CypherField[];
                },
                field
            ) => {
                const relationshipMeta = getRelationshipMeta(field);
                const cypherMeta = getCypherMeta(field);

                const baseField: BaseField = {
                    fieldName: field.name.value,
                    typeMeta: getFieldTypeMeta(field),
                    otherDirectives: (field.directives || []).filter(
                        (x) => !["relationship", "cypher"].includes(x.name.value)
                    ),
                    ...(field.arguments ? { arguments: [...field.arguments] } : { arguments: [] }),
                };

                if (relationshipMeta) {
                    const relationField: RelationField = {
                        ...baseField,
                        ...relationshipMeta,
                    };
                    res.relationFields.push(relationField);
                } else if (cypherMeta) {
                    const cypherField: CypherField = {
                        ...baseField,
                        ...cypherMeta,
                    };
                    res.cypherFields.push(cypherField);
                } else {
                    const primitiveField: PrimitiveField = {
                        ...baseField,
                    };
                    res.primitiveFields.push(primitiveField);
                }

                return res;
            },
            { relationFields: [], primitiveFields: [], cypherFields: [] }
        ) as {
            relationFields: RelationField[];
            primitiveFields: PrimitiveField[];
            cypherFields: CypherField[];
        };

        const node = new Node({
            name: definition.name.value,
            relationFields,
            primitiveFields,
            cypherFields,
            // @ts-ignore
            auth,
        });

        return node;
    });

    neoSchemaInput.nodes.forEach((node) => {
        const composeNode = composer.createObjectTC({
            name: node.name,
            fields: [...node.primitiveFields, ...node.cypherFields].reduce((res, field) => {
                const newField = {
                    type: field.typeMeta.pretty,
                    args: {},
                } as ObjectTypeComposerFieldConfigAsObjectDefinition<any, any>;

                if (field.arguments) {
                    newField.args = field.arguments.reduce((args, arg) => {
                        const meta = getFieldTypeMeta(arg);

                        return {
                            ...args,
                            [arg.name.value]: {
                                type: meta.pretty,
                                description: arg.description,
                                defaultValue: arg.defaultValue,
                            },
                        };
                    }, {});
                }

                return { ...res, [field.fieldName]: newField };
            }, {}),
        });

        composeNode.addFields(
            node.relationFields.reduce(
                (res, relation) => ({
                    ...res,
                    [relation.fieldName]: {
                        type: relation.typeMeta.pretty,
                        args: {
                            where: `${relation.typeMeta.name}Where`,
                            options: `${relation.typeMeta.name}Options`,
                        },
                    },
                }),
                {}
            )
        );

        const sortEnum = composer.createEnumTC({
            name: `${node.name}Sort`,
            values: node.primitiveFields.reduce((res, f) => {
                return {
                    ...res,
                    [`${f.fieldName}_DESC`]: { value: `${f.fieldName}_DESC` },
                    [`${f.fieldName}_ASC`]: { value: `${f.fieldName}_ASC` },
                };
            }, {}),
        });

        const queryFields = node.primitiveFields.reduce(
            (res, f) => {
                if (f.typeMeta.array) {
                    res[f.fieldName] = `[${f.typeMeta.name}]`;

                    return res;
                }

                if (["ID", "String"].includes(f.typeMeta.name)) {
                    res[`${f.fieldName}_IN`] = `[${f.typeMeta.name}]`;
                    res[`${f.fieldName}_NOT`] = `${f.typeMeta.name}`;
                    res[`${f.fieldName}_NOT_IN`] = `[${f.typeMeta.name}]`;
                    res[`${f.fieldName}_CONTAINS`] = `${f.typeMeta.name}`;
                    res[`${f.fieldName}_NOT_CONTAINS`] = `${f.typeMeta.name}`;
                    res[`${f.fieldName}_STARTS_WITH`] = `${f.typeMeta.name}`;
                    res[`${f.fieldName}_NOT_STARTS_WITH`] = `${f.typeMeta.name}`;
                    res[`${f.fieldName}_ENDS_WITH`] = `${f.typeMeta.name}`;
                    res[`${f.fieldName}_NOT_ENDS_WITH`] = `${f.typeMeta.name}`;
                }

                if (["Boolean"].includes(f.typeMeta.name)) {
                    res[`${f.fieldName}_NOT`] = `${f.typeMeta.name}`;
                }

                if (["Float", "Int"].includes(f.typeMeta.name)) {
                    res[`${f.fieldName}_IN`] = `[${f.typeMeta.name}]`;
                    res[`${f.fieldName}_NOT_IN`] = `[${f.typeMeta.name}]`;
                    res[`${f.fieldName}_NOT`] = `${f.typeMeta.name}`;
                    res[`${f.fieldName}_LT`] = `${f.typeMeta.name}`;
                    res[`${f.fieldName}_LTE`] = `${f.typeMeta.name}`;
                    res[`${f.fieldName}_GT`] = `${f.typeMeta.name}`;
                    res[`${f.fieldName}_GTE`] = `${f.typeMeta.name}`;
                }

                // equality
                res[f.fieldName] = f.typeMeta.name;

                return res;
            },
            { OR: `[${node.name}OR]`, AND: `[${node.name}AND]` }
        );

        const [andInput, orInput, whereInput] = ["AND", "OR", "Where"].map((value) => {
            return composer.createInputTC({
                name: `${node.name}${value}`,
                fields: queryFields,
            });
        });

        composer.createInputTC({
            name: `${node.name}Options`,
            fields: { sort: sortEnum.List, limit: "Int", skip: "Int" },
        });

        const nodeInput = composer.createInputTC({
            name: `${node.name}CreateInput`,
            fields: node.primitiveFields.reduce((r, f) => {
                return {
                    ...r,
                    [f.fieldName]: f.typeMeta.pretty,
                };
            }, {}),
        });

        const nodeUpdateInput = composer.createInputTC({
            name: `${node.name}UpdateInput`,
            fields: node.primitiveFields.reduce((res, f) => {
                return {
                    ...res,
                    [f.fieldName]: f.typeMeta.array ? `[${f.typeMeta.name}]` : f.typeMeta.name,
                };
            }, {}),
        });

        let nodeConnectInput: InputTypeComposer<any> = (undefined as unknown) as InputTypeComposer<any>;
        let nodeDisconnectInput: InputTypeComposer<any> = (undefined as unknown) as InputTypeComposer<any>;
        let nodeRelationInput: InputTypeComposer<any> = (undefined as unknown) as InputTypeComposer<any>;
        if (node.relationFields.length) {
            nodeConnectInput = composer.createInputTC({
                name: `${node.name}ConnectInput`,
                fields: {},
            });

            nodeDisconnectInput = composer.createInputTC({
                name: `${node.name}DisconnectInput`,
                fields: {},
            });

            nodeRelationInput = composer.createInputTC({
                name: `${node.name}RelationInput`,
                fields: {},
            });
        }

        composer.createInputTC({
            name: `${node.name}ConnectFieldInput`,
            fields: {
                where: `${node.name}Where`,
                ...(node.relationFields.length ? { connect: nodeConnectInput } : {}),
            },
        });

        composer.createInputTC({
            name: `${node.name}DisconnectFieldInput`,
            fields: {
                where: `${node.name}Where`,
                ...(node.relationFields.length ? { disconnect: nodeDisconnectInput } : {}),
            },
        });

        node.relationFields.forEach((rel) => {
            const refNode = neoSchemaInput.nodes.find((x) => x.name === rel.typeMeta.name) as Node;
            const createField = rel.typeMeta.array ? `[${refNode.name}CreateInput]` : `${refNode.name}CreateInput`;
            const updateField = `${refNode.name}UpdateInput`;
            const nodeFieldInputName = `${node.name}${upperFirstLetter(rel.fieldName)}FieldInput`;
            const nodeFieldUpdateInputName = `${node.name}${upperFirstLetter(rel.fieldName)}UpdateFieldInput`;
            const connectField = rel.typeMeta.array
                ? `[${refNode.name}ConnectFieldInput]`
                : `${refNode.name}ConnectFieldInput`;
            const disconnectField = rel.typeMeta.array
                ? `[${refNode.name}DisconnectFieldInput]`
                : `${refNode.name}DisconnectFieldInput`;

            [whereInput, andInput, orInput].forEach((inputType) => {
                inputType.addFields({
                    [rel.fieldName]: `${refNode.name}Where`,
                    [`${rel.fieldName}_NOT`]: `${refNode.name}Where`,
                });
            });

            composer.createInputTC({
                name: nodeFieldUpdateInputName,
                fields: {
                    where: `${refNode.name}Where`,
                    update: updateField,
                    connect: connectField,
                    disconnect: disconnectField,
                    create: createField,
                },
            });

            composer.createInputTC({
                name: nodeFieldInputName,
                fields: {
                    create: createField,
                    connect: connectField,
                },
            });

            nodeRelationInput.addFields({
                [rel.fieldName]: createField,
            });

            nodeInput.addFields({
                [rel.fieldName]: nodeFieldInputName,
            });

            nodeUpdateInput.addFields({
                [rel.fieldName]: rel.typeMeta.array ? `[${nodeFieldUpdateInputName}]` : nodeFieldUpdateInputName,
            });

            nodeConnectInput.addFields({
                [rel.fieldName]: connectField,
            });

            nodeDisconnectInput.addFields({
                [rel.fieldName]: disconnectField,
            });
        });

        composer.Query.addFields({
            [pluralize(node.name)]: findResolver({ node, getSchema: () => neoSchema }),
        });

        composer.Mutation.addFields({
            [`create${pluralize(node.name)}`]: createResolver({ node, getSchema: () => neoSchema }),
            [`delete${pluralize(node.name)}`]: deleteResolver({ node, getSchema: () => neoSchema }),
            [`update${pluralize(node.name)}`]: updateResolver({ node, getSchema: () => neoSchema }),
        });
    });

    const generatedTypeDefs = composer.toSDL();
    const generatedResolvers = composer.getResolveMethods();

    neoSchemaInput.typeDefs = generatedTypeDefs;
    neoSchemaInput.resolvers = generatedResolvers;
    neoSchemaInput.schema = makeExecutableSchema({
        typeDefs: generatedTypeDefs,
        resolvers: generatedResolvers,
    });

    neoSchema = new NeoSchema(neoSchemaInput);

    return neoSchema;
}

export default makeAugmentedSchema;
