import { describe, it, expect } from "vitest";
import { extractWidgetSource, compileWidget } from "./compile";

const COMPONENT = `function Widget() {
  const [v, setV] = React.useState(0.5);
  return <div>{v}</div>;
}`;

describe("extractWidgetSource", () => {
  it("pulls the component out of a fenced jsx block", () => {
    const reply = "Here you go:\n```jsx\n" + COMPONENT + "\n```\nEnjoy!";
    expect(extractWidgetSource(reply)).toBe(COMPONENT);
  });

  it("handles unlabeled fences and surrounding prose", () => {
    const reply = "```\n" + COMPONENT + "\n```";
    expect(extractWidgetSource(reply)).toBe(COMPONENT);
  });

  it("picks the fence that defines Widget when several exist", () => {
    const reply = "```js\nconst x = 1;\n```\n\n```jsx\n" + COMPONENT + "\n```";
    expect(extractWidgetSource(reply)).toBe(COMPONENT);
  });

  it("accepts bare code when the model skipped the fence", () => {
    expect(extractWidgetSource(COMPONENT)).toBe(COMPONENT);
  });

  it("returns null when no Widget definition exists", () => {
    expect(extractWidgetSource("Sorry, I can't.")).toBeNull();
    expect(extractWidgetSource("```js\nconst a = 2;\n```")).toBeNull();
  });
});

describe("compileWidget", () => {
  it("compiles JSX to React.createElement calls", async () => {
    const out = await compileWidget(COMPONENT);
    expect(out).toContain("React.createElement");
    expect(out).not.toContain("<div>");
  });

  it("throws a model-readable message on a syntax error", async () => {
    await expect(compileWidget("function Widget() { return <div>; }")).rejects.toThrow();
  });
});
