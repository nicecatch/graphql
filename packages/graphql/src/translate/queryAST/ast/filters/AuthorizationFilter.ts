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

import Cypher from "@neo4j/cypher-builder";
import { Filter } from "./Filter";
import type { QueryASTContext } from "../QueryASTContext";
import { AUTH_FORBIDDEN_ERROR } from "../../../../constants";

export class AuthorizationFilter extends Filter {
    // private operation: LogicalOperators;
    public children: Filter[];
    private requireAuthentication: boolean;
    private isAuthenticatedParam: Cypher.Param;

    constructor({
        requireAuthentication,
        filters,
        isAuthenticatedParam,
    }: {
        requireAuthentication: boolean;
        filters: Filter[];
        isAuthenticatedParam: Cypher.Param;
    }) {
        super();
        this.requireAuthentication = requireAuthentication;
        this.children = filters;
        this.isAuthenticatedParam = isAuthenticatedParam;
    }

    public getPredicate(context: QueryASTContext): Cypher.Predicate | undefined {
        let authenticationPredicate: Cypher.Predicate | undefined;
        if (this.requireAuthentication) {
            authenticationPredicate = Cypher.eq(this.isAuthenticatedParam, Cypher.true); // TODO: use it in the context
        }

        const innerPredicate = Cypher.and(
            authenticationPredicate,
            ...this.children.map((c) => c.getPredicate(context))
        );
        if (!innerPredicate) return undefined;
        return Cypher.apoc.util.validatePredicate(Cypher.not(innerPredicate), AUTH_FORBIDDEN_ERROR);
    }

    public getSubqueries(_parentNode: Cypher.Node): Cypher.Clause[] {
        return this.children.flatMap((c) => c.getSubqueries(_parentNode));
    }
}
