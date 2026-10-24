# `@afterhours/engine`

Bounded, database-free execution for AfterHours. `runWork(input, deps)` normalizes supported sources, plans fixture or live-model work, computes CSV metrics in code, validates evidence, and returns matching `WorkProduct` previews plus in-memory DOCX/PPTX files.

```ts
import { runWork } from "@afterhours/engine";

const result = await runWork(input, {
  signal: abortController.signal,
  onProgress: async (progress) => persistProgress(progress),
});
```

Fixture mode is deterministic and makes no network requests. Live mode requires `MODEL_PROVIDER=anthropic` with `ANTHROPIC_API_KEY`, or `MODEL_PROVIDER=openai` with `OPENAI_API_KEY`, plus `MODEL_NAME`; it fails closed if configuration or provider output is invalid. The engine never writes files, accesses the database, follows URLs, or sends notifications.

Supported P0 attachments are UTF-8 plain text, Markdown, and CSV. Binary PDF, DOCX, and XLSX extraction remains unsupported and is surfaced honestly when material.
