/**
 * Unit tests for the core design library.
 * Run with:  npm test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeDesign, hasMeaningfulDesign, generateMarkdown } from "../src/lib/design";

describe("normalizeDesign", () => {
  it("returns sensible defaults for an empty input", () => {
    const d = normalizeDesign({});
    assert.equal(typeof d.idea, "string");
    assert.ok(d.functional.length > 0, "functional should not be empty");
    assert.ok(d.nonFunctional.length > 0, "nonFunctional should not be empty");
    assert.ok(d.techStack.length > 0, "techStack should not be empty");
    assert.ok(d.apis.length > 0, "apis should not be empty");
  });

  it("preserves the idea string from raw input", () => {
    const d = normalizeDesign({ idea: "Real-time chat platform" });
    assert.equal(d.idea, "Real-time chat platform");
  });

  it("normalises a workingIdea fallback when idea is missing", () => {
    const d = normalizeDesign({ workingIdea: "Inventory management SaaS" });
    assert.equal(d.idea, "Inventory management SaaS");
  });

  it("maps techStack layers correctly", () => {
    const d = normalizeDesign({
      idea: "Test",
      techStack: [{ layer: "Frontend", name: "React", reason: "Component model" }],
    });
    assert.equal(d.techStack[0].name, "React");
    assert.equal(d.techStack[0].layer, "Frontend");
  });

  it("normalises API method to uppercase", () => {
    const d = normalizeDesign({
      idea: "Test",
      apis: [{ name: "Create user", method: "post", path: "/users", purpose: "Register a user" }],
    });
    assert.equal(d.apis[0].method, "POST");
  });
});

describe("hasMeaningfulDesign", () => {
  it("returns false for null", () => {
    assert.equal(hasMeaningfulDesign(null), false);
  });

  it("returns false for an empty object", () => {
    assert.equal(hasMeaningfulDesign({}), false);
  });

  it("returns true when idea is present", () => {
    assert.equal(hasMeaningfulDesign({ idea: "Anything" }), true);
  });

  it("returns true when functional requirements are present", () => {
    assert.equal(hasMeaningfulDesign({ functional: ["Req 1"] }), true);
  });

  it("returns true for a full normalised design", () => {
    assert.equal(hasMeaningfulDesign(normalizeDesign({ idea: "SaaS product" })), true);
  });
});

describe("generateMarkdown", () => {
  it("returns a non-empty string for an empty input", () => {
    const md = generateMarkdown({});
    assert.ok(typeof md === "string" && md.length > 0);
  });

  it("includes all expected section headings", () => {
    const md = generateMarkdown(normalizeDesign({ idea: "Chat app" }));
    const expectedSections = [
      "## Idea",
      "## Functional Requirements",
      "## Non-Functional Requirements",
      "## Architecture Summary",
      "## Deep analysis — trade-offs",
      "## Deep analysis — data consistency",
      "## Tech Stack",
      "## APIs",
    ];
    for (const section of expectedSections) {
      assert.ok(md.includes(section), `Missing section: ${section}`);
    }
  });

  it("includes the idea text in the output", () => {
    const md = generateMarkdown(normalizeDesign({ idea: "Unique idea string 🔍" }));
    assert.ok(md.includes("Unique idea string 🔍"));
  });

  it("generates a Mermaid diagram block when nodes exist", () => {
    const design = normalizeDesign({
      idea: "Test",
      architecture: {
        diagram: {
          nodes: [
            { id: "client", label: "Client App", role: "client", description: "UI" },
            { id: "api", label: "API Gateway", role: "balancer", description: "Routes" },
            { id: "db", label: "Database", role: "database", description: "Stores data" },
          ],
          edges: [{ from: "client", to: "api", label: "request" }],
        },
      },
    });
    const md = generateMarkdown(design);
    assert.ok(md.includes("```mermaid"), "Mermaid block should be present");
    assert.ok(md.includes("flowchart TD"), "Mermaid flowchart directive should be present");
  });
});
