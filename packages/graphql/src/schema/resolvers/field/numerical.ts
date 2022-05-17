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

import { GraphQLResolveInfo } from "graphql";
import { integer, isInt, Integer } from "neo4j-driver";
import { defaultFieldResolver } from "./defaultField";

function isIntegerable(value: unknown): value is number | string | Integer | { low: number; high: number } | bigint {
    if (!value) {
        return false;
    }

    if (["number", "string", "bigint"].includes(typeof value)) {
        return true;
    }

    if (
        typeof value === "object" &&
        Object.keys(value).length === 2 &&
        Object.prototype.hasOwnProperty.call(value, "low") &&
        Object.prototype.hasOwnProperty.call(value, "high")
    ) {
        return true;
    }

    return isInt(value);
}

function serializeValue(value) {
    if (isIntegerable(value)) {
        return integer.toNumber(value);
    }

    return value;
}

export function numericalResolver(source, args, context, info: GraphQLResolveInfo) {
    const value = defaultFieldResolver(source, args, context, info);

    if (Array.isArray(value)) {
        return value.map((v) => {
            return serializeValue(v);
        });
    }

    return serializeValue(value);
}
