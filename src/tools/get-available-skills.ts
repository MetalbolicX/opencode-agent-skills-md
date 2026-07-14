/**
 * get_available_skills tool factory.
 */

import type { Skill, SkillToolContext } from "../types";
import { findClosestMatch } from "../match";
import { searchSkills } from "../search";

export interface GetAvailableSkillsDeps {
  store: {
    all(): Promise<Skill[]>;
  };
}

export const createGetAvailableSkills = (deps: GetAvailableSkillsDeps) => {
  return {
    async execute(args: { query?: string; keywords?: string[] }, _ctx?: SkillToolContext) {
      const { store } = deps;
      const allSkills = await store.all();
      const matched = searchSkills(allSkills, args.query ?? "", args.keywords);

      if (matched.length === 0) {
        if (args.query) {
          const allSkillNames = allSkills.map((s) => s.name);
          const suggestion = findClosestMatch(args.query, allSkillNames);

          if (suggestion) {
            return `No skills found matching "${args.query}". Did you mean "${suggestion}"?`;
          }
        }

        return "No skills found matching your query.";
      }

      return matched
        .map((s) => {
          const trigger =
            s.trigger && s.trigger.length > 0 ? `\n  trigger: ${s.trigger}` : "";
          return `${s.name} (${s.label})\n  ${s.description}${trigger}`;
        })
        .join("\n\n");
    },
  };
};
