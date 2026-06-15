import { describe, it, expect } from "vitest";

/*
 * Relaxed, MECHANISM-AGNOSTIC companion to registry-tsc.test.ts (T07).
 *
 * The prompt requires that "every card type is forced by the compiler OR SOMETHING ELSE to expose
 * the search criteria." T07 grades ONLY the strict compiler route (the registry must be an
 * exhaustive `Record<union, Spec>` so extending the union without an entry breaks `tsc`). This file
 * grades the SAME intent — every card type exposes a search criterion — as the OUTCOME that a
 * compiler-`Record` AND a runtime "something else" enforcement both produce, without pinning the
 * mechanism, the `Record` shape, or the `./src/lib/classify` location.
 *
 * Complementary, not redundant:
 *   - a compiler-route impl passes T07 AND this (2);
 *   - a runtime "something else" impl passes only this (1);
 *   - an impl where some card type has no search criterion passes neither (0).
 */

// ADAPT: resolve the submission's registry of message-type specs and the field holding each type's
// search criterion. NO `Record<union>` shape and NO classify.ts location is required (that is what
// this relaxed check drops vs T07). The check is deliberately SHAPE-TOLERANT so it needs minimal
// repointing:
//   - REGISTRY: the collection of specs — an object map, an ARRAY of specs, or a `Map` are all
//     enumerated natively (reference: `@/lib/message-type-registry` `REGISTRY`, an object map). If
//     the registry is populated by side-effecting `registerX()` calls, add the side-effect import so
//     it is populated before enumeration, and point REGISTRY at the accessor's result.
//   - CRITERION_FIELD: a DOTTED path to the criterion within one spec (reference: `searchTag`;
//     others seen across submissions: `searchCriteria`, `searchCriteria.where`,
//     `searchCriteria.sqlWhere`, `whereClause`). The value is accepted if it is "populated" in ANY
//     shape — a non-empty string, a finite number, a non-empty array, an object with >=1 key, or a
//     function (a factory that produces the criterion). Only absent / "" / {} / [] fail. So an
//     object-valued or function-valued criterion is NOT a reason to fail.
import { REGISTRY } from "@/lib/message-type-registry";

const CRITERION_FIELD = "searchTag";

function specsOf(registry: unknown): unknown[] {
  if (Array.isArray(registry)) return registry;
  if (registry instanceof Map) return [...registry.values()];
  if (registry && typeof registry === "object") return Object.values(registry as Record<string, unknown>);
  return [];
}

function resolvePath(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

// "Exposes a criterion" is shape-agnostic: a non-empty string, finite number, non-empty array,
// object with >=1 key, or a function (factory) all count. Absent / "" / {} / [] fail.
function isPopulated(v: unknown): boolean {
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "function") return true;
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v as object).length > 0;
  return false;
}

function idOf(spec: unknown, index: number): string {
  if (spec && typeof spec === "object" && "id" in spec) return String((spec as { id: unknown }).id);
  return `#${index}`;
}

/*
 * T07b (relaxed): Every card type exposes a non-empty search criterion — mechanism-agnostic
 *
 * Given the registry of message/card types the viewer distinguishes (however it is shaped, located,
 *   or enforced)
 * When each registered type's spec is inspected
 * Then every type exposes a non-empty search criterion (the tag/spec used to find that type's
 *   examples in the cache) — so no card type is missing its criteria, whether exhaustiveness is
 *   enforced by the compiler (T07) or by a runtime check ("something else").
 */
describe("T07b (relaxed): every card type exposes a non-empty search criterion", () => {
  it("every registered card type maps to a spec with a non-empty search criterion", () => {
    const specs = specsOf(REGISTRY);
    expect(specs.length, "the registry should enumerate at least one card type").toBeGreaterThan(0);

    const missing = specs
      .map((spec, i) => (isPopulated(resolvePath(spec, CRITERION_FIELD)) ? null : idOf(spec, i)))
      .filter((x): x is string => x !== null);

    expect(
      missing,
      `every card type must expose a non-empty ${CRITERION_FIELD}; missing/empty for: ${missing.join(", ") || "(none)"}`,
    ).toEqual([]);
  });
});
