/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ASTVisitor, ObjectTypeDefinitionNode, InterfaceTypeDefinitionNode } from "graphql";
import { GraphQLError } from "graphql";
import type { SDLValidationContext } from "graphql/validation/ValidationContext";
import { assertValid, DocumentValidationError } from "../utils/document-validation-error";

export function ValidDirectiveInheritance() {
    return function (context: SDLValidationContext): ASTVisitor {
        // TODO: maybe make ts understand Map1.string and Map2.string[] refer to the same category
        const interfacesToExludeDirectiveMap = new Map<string, boolean>();
        const multipleInheritedInterfaces = new Map<string, string[]>();

        return {
            ObjectTypeDefinition(objectType: ObjectTypeDefinitionNode) {
                if (objectType.interfaces && objectType.interfaces.length > 1) {
                    multipleInheritedInterfaces.set(
                        objectType.name.value,
                        objectType.interfaces.map((i) => i.name.value)
                    );
                }
            },
            InterfaceTypeDefinition(interfaceType: InterfaceTypeDefinitionNode) {
                if (!interfaceType.directives) {
                    return;
                }
                const excludeDirective = interfaceType.directives.find((d) => d.name.value === "exclude");
                interfacesToExludeDirectiveMap.set(interfaceType.name.value, !!excludeDirective);

                if (!!excludeDirective === false) {
                    return;
                }

                const { isValid, errorMsg, errorPath } = assertValid(
                    assertMultipleInheritance.bind(null, interfacesToExludeDirectiveMap, multipleInheritedInterfaces)
                );

                if (!isValid) {
                    const errorOpts = {
                        nodes: [interfaceType],
                        path: errorPath,
                        source: undefined,
                        positions: undefined,
                        originalError: undefined,
                    };

                    // TODO: replace constructor to use errorOpts when dropping support for GraphQL15
                    context.reportError(
                        new GraphQLError(
                            errorMsg || "Error",
                            errorOpts.nodes,
                            errorOpts.source,
                            errorOpts.positions,
                            errorOpts.path,
                            errorOpts.originalError
                        )
                    );
                }
            },
        };
    };
}

function assertMultipleInheritance(
    interfacesToExludeDirectiveMap: Map<string, boolean>,
    multipleInheritedInterfaces: Map<string, string[]>
) {
    for (const [typeName, implementedInterfaces] of multipleInheritedInterfaces.entries()) {
        let isMultipleInherited = false;
        for (const interfaceName of implementedInterfaces) {
            if (interfacesToExludeDirectiveMap.get(interfaceName) === true) {
                if (isMultipleInherited) {
                    throw new DocumentValidationError(
                        `Multiple implemented interfaces of ${typeName} have @exclude directive - cannot determine directive to use.`,
                        [typeName]
                    );
                } else {
                    isMultipleInherited = true;
                }
            }
        }
    }
}
