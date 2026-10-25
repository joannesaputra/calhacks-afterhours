// Fixture helpers for tests. Not imported by production code (exported as "@afterhours/engine/testing").
import PptxGenJS from "pptxgenjs";

export interface FixtureSlide { title: string; bullets: string[]; notes?: string }

/**
 * Build a real .pptx with pptxgenjs. `placeholders` gives title/body placeholder shapes like a template-based deck;
 * `textboxes` gives free text boxes like decks this product generates itself.
 */
export async function buildDeckFixture(slides: FixtureSlide[], mode: "placeholders" | "textboxes" = "placeholders"): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = "Fixture deck";
  pptx.defineSlideMaster({
    title: "FIXTURE",
    background: { color: "FFFFFF" },
    objects: mode === "placeholders" ? [
      { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.4, w: 12, h: 0.9, fontSize: 28, bold: true }, text: "" } },
      { placeholder: { options: { name: "body", type: "body", x: 0.6, y: 1.6, w: 12, h: 4.8, fontSize: 20 }, text: "" } },
    ] : [],
  });
  for (const s of slides) {
    const slide = pptx.addSlide({ masterName: "FIXTURE" });
    if (mode === "placeholders") {
      slide.addText(s.title, { placeholder: "title" });
      slide.addText(s.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })), { placeholder: "body" });
    } else {
      slide.addText(s.title, { x: 0.6, y: 0.4, w: 12, h: 0.9, fontSize: 28, bold: true });
      slide.addText(s.bullets.map((text) => ({ text, options: { bullet: { indent: 18 }, breakLine: true } })), { x: 0.6, y: 1.6, w: 12, h: 4.8, fontSize: 20 });
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  return new Uint8Array((await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer);
}
