## Context

The current popup already has a primary heading in `src/popup/index.html`. This example demonstrates a copy-only change with no architectural or runtime impact.

## Goals / Non-Goals

**Goals:**

- Make the sample nature of the popup explicit in its visible heading.
- Keep the change limited to the existing heading element.

**Non-Goals:**

- Changing element selection, Console capture, clipboard, styles, or persistence.
- Adding localization, dependencies, permissions, or network requests.

## Decisions

- Update the existing heading text in place. This preserves the DOM structure and avoids unnecessary changes to CSS or tests.
- Use the existing product wording with a `· 示例` suffix because the current UI is Chinese/English mixed and the suffix communicates that this is sample content.

## Risks / Trade-offs

- [Risk] The example wording may not suit a copied product. → [Mitigation] Treat this change as a sample and replace the title during project customization.

## Migration Plan

No migration is required. A copied project can replace the heading text as part of its initial customization.
